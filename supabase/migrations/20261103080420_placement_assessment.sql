BEGIN;
ALTER TABLE public.users ADD COLUMN placement_onboarded_at timestamptz;
ALTER TABLE public.users ADD COLUMN english_route_level text CHECK(english_route_level IN ('A1','A2','B1','B2','C1','C2'));
CREATE FUNCTION public.placement_rank(p_level text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT array_position(ARRAY['A1','A2','B1','B2','C1','C2'],p_level) $$;
CREATE TABLE public.placement_test_questions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE,
 bank_version text NOT NULL, level text NOT NULL CHECK(level IN ('A1','A2','B1','B2','C1','C2')),
 category text NOT NULL CHECK(category IN ('grammar','vocabulary','reading')),
 prompt text NOT NULL CHECK(length(prompt) BETWEEN 1 AND 1000), passage text CHECK(length(passage)<=5000),
 options jsonb NOT NULL CHECK(jsonb_typeof(options)='array' AND jsonb_array_length(options)=4),
 correct_option text NOT NULL CHECK(correct_option IN ('a','b','c','d')),
 explanation text NOT NULL CHECK(length(explanation) BETWEEN 1 AND 1000), topic text NOT NULL,
 active boolean NOT NULL DEFAULT true, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX placement_questions_selection_idx ON public.placement_test_questions(category,level) WHERE active;
CREATE TABLE public.placement_test_attempts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 language_id uuid NOT NULL REFERENCES public.languages(id), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
 algorithm_version text NOT NULL DEFAULT 'grid-irt-v1' CHECK(algorithm_version='grid-irt-v1'),
 posterior jsonb NOT NULL DEFAULT '[0.36,0.26,0.18,0.11,0.06,0.03]' CHECK(jsonb_typeof(posterior)='array' AND jsonb_array_length(posterior)=6),
 answered integer NOT NULL DEFAULT 0 CHECK(answered BETWEEN 0 AND 20),
 served_questions uuid[] NOT NULL DEFAULT '{}' CHECK(cardinality(served_questions)<=20),
 current_question_id uuid REFERENCES public.placement_test_questions(id), current_snapshot jsonb,
 result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(id,user_id), UNIQUE(id,user_id,language_id),
 CHECK((status='completed' AND result IS NOT NULL AND completed_at IS NOT NULL AND current_question_id IS NULL) OR (status<>'completed' AND result IS NULL AND completed_at IS NULL)),
 CHECK((current_question_id IS NULL)=(current_snapshot IS NULL)),
 CHECK(status<>'completed' OR answered>=12),
 CHECK(completed_at IS NULL OR completed_at>=created_at)
);
CREATE UNIQUE INDEX placement_one_active_idx ON public.placement_test_attempts(user_id,language_id) WHERE status='active';
CREATE INDEX placement_attempts_history_idx ON public.placement_test_attempts(user_id,created_at DESC);
CREATE INDEX placement_attempts_language_idx ON public.placement_test_attempts(language_id);
CREATE INDEX placement_attempts_question_idx ON public.placement_test_attempts(current_question_id);
CREATE TABLE public.placement_test_answers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attempt_id uuid NOT NULL, user_id uuid NOT NULL,
 question_id uuid NOT NULL REFERENCES public.placement_test_questions(id), request_id uuid NOT NULL,
 option_id text NOT NULL CHECK(option_id IN ('a','b','c','d')), correct boolean NOT NULL,
 difficulty integer NOT NULL CHECK(difficulty BETWEEN 1 AND 6), category text NOT NULL CHECK(category IN ('grammar','vocabulary','reading')),
 topic text NOT NULL, feedback jsonb NOT NULL, answered_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(attempt_id,user_id) REFERENCES public.placement_test_attempts(id,user_id) ON DELETE CASCADE,
 UNIQUE(attempt_id,question_id), UNIQUE(attempt_id,request_id)
);
CREATE INDEX placement_answers_user_idx ON public.placement_test_answers(user_id);
CREATE INDEX placement_answers_question_idx ON public.placement_test_answers(question_id);
CREATE TABLE public.user_language_levels (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, language_id uuid NOT NULL REFERENCES public.languages(id),
 level text NOT NULL CHECK(level IN ('A1','A2','B1','B2','C1','C2')), source text NOT NULL CHECK(source IN ('adaptive','beginner')),
 latest_attempt_id uuid, assessment jsonb NOT NULL, assessed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,language_id),
 FOREIGN KEY(latest_attempt_id,user_id,language_id) REFERENCES public.placement_test_attempts(id,user_id,language_id),
 CHECK((source='adaptive' AND latest_attempt_id IS NOT NULL) OR (source='beginner' AND latest_attempt_id IS NULL))
);
CREATE INDEX language_levels_language_idx ON public.user_language_levels(language_id);
CREATE INDEX language_levels_attempt_idx ON public.user_language_levels(latest_attempt_id);
CREATE TABLE public.user_skill_assessments (
 user_id uuid NOT NULL, language_id uuid NOT NULL, attempt_id uuid NOT NULL,
 category text NOT NULL CHECK(category IN ('grammar','vocabulary','reading')),
 answered integer NOT NULL CHECK(answered BETWEEN 1 AND 20), correct integer NOT NULL CHECK(correct BETWEEN 0 AND answered),
 accuracy integer NOT NULL CHECK(accuracy BETWEEN 0 AND 100), assessed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,language_id,attempt_id,category),
 FOREIGN KEY(attempt_id,user_id,language_id) REFERENCES public.placement_test_attempts(id,user_id,language_id) ON DELETE CASCADE
);
CREATE INDEX skill_assessments_attempt_idx ON public.user_skill_assessments(attempt_id);
CREATE INDEX skill_assessments_language_idx ON public.user_skill_assessments(language_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['placement_test_questions','placement_test_attempts','placement_test_answers','user_language_levels','user_skill_assessments'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;

CREATE FUNCTION public.placement_import_questions(p_document jsonb) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE q jsonb; o jsonb; n integer:=0;
BEGIN
 IF p_document->>'version'<>'placement-en-ru-v1' OR p_document->>'language'<>'en' OR jsonb_typeof(p_document->'questions')<>'array' OR jsonb_array_length(p_document->'questions') NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid placement bank'; END IF;
 FOR q IN SELECT value FROM jsonb_array_elements(p_document->'questions') LOOP
  IF jsonb_typeof(q)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(q) k WHERE k NOT IN ('code','level','category','prompt','passage','options','correctOption','explanation','topic')) OR
   coalesce(q->>'code','')!~'^[a-z0-9-]{5,100}$' OR public.placement_rank(q->>'level') IS NULL OR coalesce(q->>'category','') NOT IN ('grammar','vocabulary','reading') OR
   coalesce(length(q->>'prompt'),0) NOT BETWEEN 1 AND 1000 OR coalesce(length(q->>'explanation'),0) NOT BETWEEN 1 AND 1000 OR coalesce(length(q->>'topic'),0) NOT BETWEEN 1 AND 160 OR
   coalesce(length(q->>'passage'),0)>5000 OR ((q->>'category')='reading' AND coalesce(length(q->>'passage'),0)<20) OR
   coalesce(jsonb_typeof(q->'options'),'null')<>'array' OR jsonb_array_length(q->'options')<>4 THEN RAISE EXCEPTION 'invalid placement question'; END IF;
  IF (SELECT count(DISTINCT trim(value->>'label')) FROM jsonb_array_elements(q->'options'))<>4 OR (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(q->'options'))<>4 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q->'options') WHERE value->>'id'=q->>'correctOption') THEN RAISE EXCEPTION 'invalid placement options'; END IF;
  FOR o IN SELECT value FROM jsonb_array_elements(q->'options') LOOP
   IF jsonb_typeof(o)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(o) k WHERE k NOT IN ('id','label')) OR coalesce(o->>'id','') NOT IN ('a','b','c','d') OR coalesce(length(o->>'label'),0) NOT BETWEEN 1 AND 600 THEN RAISE EXCEPTION 'invalid placement option'; END IF;
  END LOOP;
  INSERT INTO public.placement_test_questions(code,bank_version,level,category,prompt,passage,options,correct_option,explanation,topic)
   VALUES(q->>'code',p_document->>'version',q->>'level',q->>'category',q->>'prompt',q->>'passage',q->'options',q->>'correctOption',q->>'explanation',q->>'topic')
   ON CONFLICT(code) DO UPDATE SET bank_version=excluded.bank_version,level=excluded.level,category=excluded.category,prompt=excluded.prompt,passage=excluded.passage,options=excluded.options,correct_option=excluded.correct_option,explanation=excluded.explanation,topic=excluded.topic,active=true,updated_at=now();
  n:=n+1;
 END LOOP;
 RETURN n;
END $$;

-- Trusted internal helper. The DTO explicitly lists fields; it never serializes the private row.
CREATE FUNCTION public.placement_attempt_state(p_user uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.placement_test_attempts; q jsonb;
BEGIN
 SELECT * INTO a FROM public.placement_test_attempts WHERE id=p_attempt AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 q:=a.current_snapshot;
 RETURN jsonb_build_object('id',a.id,'status',a.status,'answered',a.answered,'minimum',12,'maximum',20,'question',CASE WHEN q IS NULL THEN NULL ELSE jsonb_build_object('id',a.current_question_id,'category',q->>'category','prompt',q->>'prompt','passage',q->>'passage','options',q->'options') END,'result',a.result);
END $$;

CREATE FUNCTION public.placement_recommendations(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE target text; suggestions jsonb;
BEGIN
 SELECT coalesce(u.english_route_level,ll.level,'A1') INTO target FROM public.users u LEFT JOIN public.user_language_levels ll ON ll.user_id=u.id AND ll.language_id=(SELECT id FROM public.languages WHERE code='en') WHERE u.id=p_user;
 SELECT coalesce(jsonb_agg(to_jsonb(r)-'distance'-'done' ORDER BY r.done,r.distance,r.course_id,r.unit_position,r.lesson_position),'[]') INTO suggestions FROM (
  SELECT c.id AS course_id,c.title AS course_title,c.level,u.title AS unit_title,u.position AS unit_position,l.id AS lesson_id,l.title AS lesson_title,l.position AS lesson_position,
   abs(public.placement_rank(c.level)-public.placement_rank(target)) AS distance,
   EXISTS(SELECT 1 FROM public.user_progress p WHERE p.user_id=p_user AND p.lesson_id=l.id AND p.best_score>=60) AS done
  FROM public.courses c JOIN public.languages lang ON lang.id=c.language_id JOIN public.units u ON u.course_id=c.id JOIN public.lessons l ON l.unit_id=u.id
  WHERE lang.code='en' AND lang.active AND c.published AND l.published AND public.can_access_lesson(p_user,l.id)
  AND NOT EXISTS(SELECT 1 FROM public.lessons prev JOIN public.units pu ON pu.id=prev.unit_id WHERE pu.course_id=c.id AND prev.published AND (pu.position<u.position OR (pu.position=u.position AND prev.position<l.position)) AND NOT EXISTS(SELECT 1 FROM public.user_progress p WHERE p.user_id=p_user AND p.lesson_id=prev.id AND p.best_score>=60))
  ORDER BY done,distance,c.created_at,c.id,u.position,l.position LIMIT 5
 ) r;
 RETURN suggestions;
END $$;

CREATE FUNCTION public.placement_status(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE a uuid; assessment jsonb; history jsonb; onboarded boolean; route text;
BEGIN
 SELECT placement_onboarded_at IS NOT NULL,english_route_level INTO onboarded,route FROM public.users WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 SELECT ll.assessment INTO assessment FROM public.user_language_levels ll JOIN public.languages l ON l.id=ll.language_id WHERE ll.user_id=p_user AND l.code='en';
 SELECT id INTO a FROM public.placement_test_attempts WHERE user_id=p_user AND status='active' ORDER BY created_at DESC LIMIT 1;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',h.id,'level',h.result->>'level','confidence',h.result->'confidence','completedAt',h.completed_at) ORDER BY h.completed_at DESC),'[]') INTO history FROM (SELECT id,result,completed_at FROM public.placement_test_attempts WHERE user_id=p_user AND status='completed' ORDER BY completed_at DESC LIMIT 20) h;
 RETURN jsonb_build_object('onboarded',onboarded,'attempt',CASE WHEN a IS NULL THEN NULL ELSE public.placement_attempt_state(p_user,a) END,'assessment',assessment,'routeLevel',coalesce(route,assessment->>'level','A1'),'recommendations',public.placement_recommendations(p_user),'history',history);
END $$;

CREATE FUNCTION public.placement_select_question(p_attempt uuid,p_difficulty integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.placement_test_attempts; q public.placement_test_questions; cat text; opts jsonb;
BEGIN
 SELECT * INTO STRICT a FROM public.placement_test_attempts WHERE id=p_attempt;
 cat:=(ARRAY['grammar','vocabulary','reading'])[1+(a.answered%3)];
 SELECT * INTO q FROM public.placement_test_questions WHERE active AND category=cat AND NOT(id=ANY(a.served_questions)) ORDER BY abs(public.placement_rank(level)-p_difficulty),md5(id::text||a.id::text) LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'placement bank unavailable'; END IF;
 SELECT jsonb_agg(value ORDER BY md5((value->>'id')||a.id::text||q.id::text)) INTO opts FROM jsonb_array_elements(q.options);
 UPDATE public.placement_test_attempts SET current_question_id=q.id,current_snapshot=jsonb_set(to_jsonb(q),'{options}',opts),served_questions=served_questions||q.id,updated_at=now() WHERE id=a.id;
END $$;

CREATE FUNCTION public.placement_start(p_user uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_id uuid; lang uuid;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.placement_test_attempts WHERE id=p_request AND user_id<>p_user) THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 SELECT id INTO current_id FROM public.placement_test_attempts WHERE user_id=p_user AND status='active';
 IF current_id IS NOT NULL OR EXISTS(SELECT 1 FROM public.placement_test_attempts WHERE id=p_request AND user_id=p_user) THEN RETURN public.placement_status(p_user); END IF;
 IF (SELECT count(*) FROM public.placement_test_attempts WHERE user_id=p_user AND created_at>now()-interval '24 hours')>=5 THEN RAISE EXCEPTION 'placement daily limit'; END IF;
 IF (SELECT count(*) FROM public.placement_test_questions WHERE active)<120 THEN RAISE EXCEPTION 'placement bank unavailable'; END IF;
 SELECT id INTO lang FROM public.languages WHERE code='en' AND active;
 IF lang IS NULL THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 INSERT INTO public.placement_test_attempts(id,user_id,language_id) VALUES(p_request,p_user,lang);
 PERFORM public.placement_select_question(p_request,1);
 RETURN public.placement_status(p_user);
END $$;

CREATE FUNCTION public.placement_finish(p_attempt uuid,p_rank integer,p_confidence numeric,p_low integer,p_high integer) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.placement_test_attempts; v_result jsonb; categories jsonb; strengths jsonb; improve jsonb; level text;
BEGIN
 SELECT * INTO STRICT a FROM public.placement_test_attempts WHERE id=p_attempt;
 level:=(ARRAY['A1','A2','B1','B2','C1','C2'])[p_rank];
 SELECT jsonb_object_agg(category,jsonb_build_object('answered',n,'correct',right_count,'accuracy',round(100.0*right_count/n))) INTO categories FROM (SELECT category,count(*) AS n,count(*) FILTER(WHERE correct) AS right_count FROM public.placement_test_answers WHERE attempt_id=a.id GROUP BY category) s;
 SELECT coalesce(jsonb_agg(category),'[]') INTO strengths FROM (SELECT category FROM public.placement_test_answers WHERE attempt_id=a.id GROUP BY category HAVING count(*)>=3 AND avg(correct::integer)>=0.7 ORDER BY category) s;
 SELECT coalesce(jsonb_agg(topic),'[]') INTO improve FROM (SELECT DISTINCT topic FROM public.placement_test_answers WHERE attempt_id=a.id AND NOT correct ORDER BY topic LIMIT 5) s;
 v_result:=jsonb_build_object('level',level,'source','adaptive','confidence',p_confidence,'interval',jsonb_build_object('from',(ARRAY['A1','A2','B1','B2','C1','C2'])[p_low],'to',(ARRAY['A1','A2','B1','B2','C1','C2'])[p_high]),'questions',a.answered,'categories',categories,'strengths',strengths,'improvements',improve,'assessedAt',now(),'algorithmVersion',a.algorithm_version);
 UPDATE public.placement_test_attempts SET status='completed',result=v_result,completed_at=now(),current_question_id=NULL,current_snapshot=NULL,updated_at=now() WHERE id=a.id;
 INSERT INTO public.user_language_levels(user_id,language_id,level,source,latest_attempt_id,assessment) VALUES(a.user_id,a.language_id,level,'adaptive',a.id,v_result) ON CONFLICT(user_id,language_id) DO UPDATE SET level=excluded.level,source=excluded.source,latest_attempt_id=excluded.latest_attempt_id,assessment=excluded.assessment,assessed_at=now();
 INSERT INTO public.user_skill_assessments(user_id,language_id,attempt_id,category,answered,correct,accuracy) SELECT a.user_id,a.language_id,a.id,category,count(*),count(*) FILTER(WHERE correct),round(100.0*count(*) FILTER(WHERE correct)/count(*)) FROM public.placement_test_answers WHERE attempt_id=a.id GROUP BY category;
 UPDATE public.users SET placement_onboarded_at=coalesce(placement_onboarded_at,now()),english_route_level=NULL WHERE id=a.user_id;
END $$;

CREATE FUNCTION public.placement_answer(p_user uuid,p_attempt uuid,p_question uuid,p_request uuid,p_option text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.placement_test_attempts; prior public.placement_test_answers; q jsonb; right_answer boolean; weights double precision[]; probability double precision; total double precision; best integer:=1; low integer:=1; high integer:=6; cumulative double precision:=0; i integer; mean double precision:=0; advanced integer; coverage integer; feedback jsonb; target integer;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO a FROM public.placement_test_attempts WHERE id=p_attempt AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 SELECT * INTO prior FROM public.placement_test_answers WHERE attempt_id=a.id AND request_id=p_request;
 IF NOT FOUND THEN SELECT * INTO prior FROM public.placement_test_answers WHERE attempt_id=a.id AND question_id=p_question; END IF;
 IF FOUND THEN
  IF prior.question_id<>p_question OR prior.option_id<>p_option THEN RAISE EXCEPTION 'placement answer conflict'; END IF;
  RETURN jsonb_build_object('feedback',prior.feedback,'status',public.placement_status(p_user));
 END IF;
 IF a.status<>'active' OR a.current_question_id<>p_question THEN RAISE EXCEPTION 'placement out of order'; END IF;
 q:=a.current_snapshot;
 IF p_option IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q->'options') WHERE value->>'id'=p_option) THEN RAISE EXCEPTION 'placement invalid option'; END IF;
 right_answer:=(q->>'correct_option')=p_option;
 feedback:=jsonb_build_object('questionId',p_question,'correct',right_answer,'correctOption',q->>'correct_option','explanation',q->>'explanation');
 INSERT INTO public.placement_test_answers(attempt_id,user_id,question_id,request_id,option_id,correct,difficulty,category,topic,feedback) VALUES(a.id,p_user,p_question,p_request,p_option,right_answer,public.placement_rank(q->>'level'),q->>'category',q->>'topic',feedback);
 weights:=ARRAY(SELECT value::double precision FROM jsonb_array_elements_text(a.posterior));
 FOR i IN 1..6 LOOP
  probability:=0.25+0.72/(1+exp(-1.4*(i-public.placement_rank(q->>'level'))));
  weights[i]:=weights[i]*CASE WHEN right_answer THEN probability ELSE 1-probability END;
 END LOOP;
 SELECT sum(value) INTO total FROM unnest(weights) value;
 FOR i IN 1..6 LOOP weights[i]:=weights[i]/total; mean:=mean+i*weights[i]; END LOOP;
 -- Normalize first, then find the mode (no comparison of normalized and raw values).
 best:=1;FOR i IN 2..6 LOOP IF weights[i]>weights[best] THEN best:=i; END IF; END LOOP;
 cumulative:=0;low:=6;high:=6;
 FOR i IN 1..6 LOOP cumulative:=cumulative+weights[i]; IF cumulative>=0.1 AND low=6 THEN low:=i; END IF; IF cumulative>=0.9 THEN high:=i; EXIT; END IF; END LOOP;
 a.answered:=a.answered+1;
 UPDATE public.placement_test_attempts SET answered=a.answered,posterior=to_jsonb(weights),updated_at=now() WHERE id=a.id;
 best:=least(best,(SELECT max(difficulty) FROM public.placement_test_answers WHERE attempt_id=a.id));
 SELECT count(*) INTO advanced FROM public.placement_test_answers WHERE attempt_id=a.id AND correct AND difficulty>=greatest(3,best-1);
 IF best>=4 AND (advanced<4 OR (SELECT count(DISTINCT category) FROM public.placement_test_answers WHERE attempt_id=a.id AND correct)<3) THEN best:=3; END IF;
 SELECT count(*) INTO coverage FROM (SELECT category FROM public.placement_test_answers WHERE attempt_id=a.id GROUP BY category HAVING count(*)>=3) s;
 IF a.answered>=20 OR (a.answered>=12 AND coverage=3 AND weights[best]>=0.8 AND high-low<=1 AND (best<4 OR advanced>=4)) THEN
  low:=least(low,best);high:=greatest(high,best);
  PERFORM public.placement_finish(a.id,best,round(weights[best]::numeric,3),low,high);
 ELSE
  target:=CASE WHEN right_answer THEN least(public.placement_rank(q->>'level')+1,greatest(public.placement_rank(q->>'level'),round(mean)::integer)) ELSE greatest(1,least(public.placement_rank(q->>'level')-1,round(mean)::integer)) END;
  PERFORM public.placement_select_question(a.id,target);
 END IF;
 RETURN jsonb_build_object('feedback',feedback,'status',public.placement_status(p_user));
END $$;

CREATE FUNCTION public.placement_beginner(p_user uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE lang uuid; assessment jsonb;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 SELECT id INTO lang FROM public.languages WHERE code='en' AND active;
 IF lang IS NULL THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.user_language_levels WHERE user_id=p_user AND language_id=lang) THEN
  assessment:=jsonb_build_object('level','A1','source','beginner','confidence',NULL,'interval',NULL,'questions',0,'categories','{}'::jsonb,'strengths','[]'::jsonb,'improvements','[]'::jsonb,'assessedAt',now());
  INSERT INTO public.user_language_levels(user_id,language_id,level,source,assessment) VALUES(p_user,lang,'A1','beginner',assessment);
  UPDATE public.placement_test_attempts SET status='abandoned',current_question_id=NULL,current_snapshot=NULL,updated_at=now() WHERE user_id=p_user AND status='active';
 END IF;
 UPDATE public.users SET placement_onboarded_at=coalesce(placement_onboarded_at,now()) WHERE id=p_user;
 RETURN public.placement_status(p_user);
END $$;
CREATE FUNCTION public.placement_set_route(p_user uuid,p_level text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF public.placement_rank(p_level) IS NULL THEN RAISE EXCEPTION 'placement invalid level'; END IF;
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT EXISTS(SELECT 1 FROM public.user_language_levels WHERE user_id=p_user) THEN RAISE EXCEPTION 'placement unavailable'; END IF;
 UPDATE public.users SET english_route_level=p_level WHERE id=p_user;
 RETURN public.placement_status(p_user);
END $$;
CREATE FUNCTION public.placement_database_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ok boolean:=true; t text; fn record; total integer;
BEGIN
 FOREACH t IN ARRAY ARRAY['placement_test_questions','placement_test_attempts','placement_test_answers','user_language_levels','user_skill_assessments'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=t AND c.relrowsecurity) OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN ok:=false; END IF;
 END LOOP;
 FOR fn IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'placement_%' LOOP
  IF has_function_privilege('anon',fn.oid,'EXECUTE') OR has_function_privilege('authenticated',fn.oid,'EXECUTE') THEN ok:=false; END IF;
 END LOOP;

 FOREACH t IN ARRAY ARRAY['placement_onboarded_at','english_route_level'] LOOP
  IF has_column_privilege('anon','public.users',t,'UPDATE') OR has_column_privilege('authenticated','public.users',t,'UPDATE') THEN ok:=false; END IF;
 END LOOP;
 FOR fn IN SELECT signature FROM (VALUES('public.placement_status(uuid)'),('public.placement_start(uuid,uuid)'),('public.placement_answer(uuid,uuid,uuid,uuid,text)'),('public.placement_beginner(uuid)'),('public.placement_set_route(uuid,text)'),('public.placement_import_questions(jsonb)'),('public.placement_database_status()')) s(signature) LOOP
  IF NOT has_function_privilege('service_role',fn.signature,'EXECUTE') THEN ok:=false; END IF;
 END LOOP;
 SELECT count(*) INTO total FROM public.placement_test_questions WHERE active;
 IF total<120 OR EXISTS(SELECT 1 FROM unnest(ARRAY['A1','A2','B1','B2','C1','C2']) l WHERE (SELECT count(*) FROM public.placement_test_questions q WHERE q.level=l AND q.active)<20) THEN ok:=false; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['A1','A2','B1','B2','C1','C2']) l CROSS JOIN unnest(ARRAY['grammar','vocabulary','reading']) c WHERE (SELECT count(*) FROM public.placement_test_questions q WHERE q.level=l AND q.category=c AND q.active)<3) THEN ok:=false; END IF;
 RETURN jsonb_build_object('ready',ok,'version','grid-irt-v1','questions',total,'tables',5);
END $$;
DO $$ DECLARE f record; BEGIN
 FOR f IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'placement_%' LOOP EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated,service_role',f.signature); END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION public.placement_import_questions(jsonb),public.placement_status(uuid),public.placement_start(uuid,uuid),public.placement_answer(uuid,uuid,uuid,uuid,text),public.placement_beginner(uuid),public.placement_set_route(uuid,text),public.placement_database_status() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
