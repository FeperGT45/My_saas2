BEGIN;
GRANT EXECUTE ON FUNCTION public.placement_rank(text) TO service_role;
CREATE TABLE public.appearance_settings(user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,theme text NOT NULL DEFAULT 'base' CHECK(theme IN('base','slate','ocean','midnight','cyber','neon','sunset','sakura')),frame text NOT NULL DEFAULT 'plain' CHECK(frame IN('plain','orbit','pulse')),badge text NOT NULL DEFAULT 'none' CHECK(badge IN('none','star','leaf')),effect text NOT NULL DEFAULT 'none' CHECK(effect IN('none','spark','ripple')),decoration text NOT NULL DEFAULT 'none' CHECK(decoration IN('none','dots','grid')),version integer NOT NULL DEFAULT 0);
ALTER TABLE public.appearance_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appearance_settings FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.appearance_settings TO service_role;
GRANT SELECT ON public.appearance_settings TO authenticated;
CREATE POLICY appearance_owner ON public.appearance_settings FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE FUNCTION public.appearance_public(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN public.has_feature(p_user,'extra_exercises') THEN jsonb_build_object('theme',coalesce(s.theme,'base'),'frame',coalesce(s.frame,'plain'),'badge',coalesce(s.badge,'none'),'effect',coalesce(s.effect,'none'),'decoration',coalesce(s.decoration,'none')) ELSE jsonb_build_object('theme',CASE WHEN s.theme IN('base','slate','ocean') THEN s.theme ELSE 'base' END,'frame','plain','badge','none','effect','none','decoration','none') END FROM (SELECT 1) one LEFT JOIN public.appearance_settings s ON s.user_id=p_user
$$;
CREATE FUNCTION public.appearance_read(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('premium',public.has_feature(p_user,'extra_exercises'),'expiresAt',public.premium_status(p_user)->'expiresAt','serverTime',now(),'version',coalesce(s.version,0),'saved',coalesce(to_jsonb(s)-'user_id'-'version','{"theme":"base","frame":"plain","badge":"none","effect":"none","decoration":"none"}'),'effective',public.appearance_public(p_user)) FROM (SELECT 1) one LEFT JOIN public.appearance_settings s ON s.user_id=p_user
$$;
CREATE FUNCTION public.appearance_save(p_user uuid,p_data jsonb,p_version integer) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE old public.appearance_settings;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO old FROM public.appearance_settings WHERE user_id=p_user;
 IF p_version IS NULL OR coalesce(old.version,0)<>p_version THEN RAISE EXCEPTION 'appearance conflict'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>5 OR NOT (p_data ?& ARRAY['theme','frame','badge','effect','decoration']) OR p_data->>'theme' NOT IN('base','slate','ocean','midnight','cyber','neon','sunset','sakura') OR p_data->>'frame' NOT IN('plain','orbit','pulse') OR p_data->>'badge' NOT IN('none','star','leaf') OR p_data->>'effect' NOT IN('none','spark','ripple') OR p_data->>'decoration' NOT IN('none','dots','grid') OR EXISTS(SELECT 1 FROM jsonb_each(p_data) WHERE jsonb_typeof(value)<>'string') THEN RAISE EXCEPTION 'invalid appearance'; END IF;
 IF NOT public.has_feature(p_user,'extra_exercises') AND (p_data->>'theme' NOT IN('base','slate','ocean') OR p_data->>'frame'<>'plain' OR p_data->>'badge'<>'none' OR p_data->>'effect'<>'none' OR p_data->>'decoration'<>'none') THEN RAISE EXCEPTION 'premium required'; END IF;
 INSERT INTO public.appearance_settings(user_id,theme,frame,badge,effect,decoration,version) VALUES(p_user,p_data->>'theme',p_data->>'frame',p_data->>'badge',p_data->>'effect',p_data->>'decoration',p_version+1) ON CONFLICT(user_id) DO UPDATE SET theme=excluded.theme,frame=excluded.frame,badge=excluded.badge,effect=excluded.effect,decoration=excluded.decoration,version=excluded.version;
 RETURN public.appearance_read(p_user);
END $$;
-- Only opted-in, public aliases receive effective cosmetics, never private saved settings or Telegram IDs.
DO $$ DECLARE d text; revised text; BEGIN
 d:=pg_get_functiondef('public.social_summary(uuid,text,integer)'::regprocedure);
 revised:=replace(d,$x$'isMe',id=p_user$x$,$y$'isMe',id=p_user,'appearance',public.appearance_public(id)$y$);
 IF d=revised THEN RAISE EXCEPTION 'social appearance integration unavailable'; END IF;EXECUTE revised;
END $$;

CREATE TABLE public.extended_attempts(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,status text NOT NULL DEFAULT 'active' CHECK(status IN('active','completed')),answered integer NOT NULL DEFAULT 0 CHECK(answered BETWEEN 0 AND 36),posterior jsonb NOT NULL DEFAULT '[0.36,0.26,0.18,0.11,0.06,0.03]',current jsonb,served uuid[] NOT NULL DEFAULT '{}',result jsonb,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(id,user_id));
CREATE UNIQUE INDEX extended_one_active ON public.extended_attempts(user_id) WHERE status='active';
CREATE INDEX extended_history ON public.extended_attempts(user_id,created_at DESC);
CREATE TABLE public.extended_answers(attempt_id uuid NOT NULL,user_id uuid NOT NULL,position integer NOT NULL,request_id uuid NOT NULL,question jsonb NOT NULL,option_id text NOT NULL,correct boolean NOT NULL,PRIMARY KEY(attempt_id,position),UNIQUE(attempt_id,request_id),FOREIGN KEY(attempt_id,user_id) REFERENCES public.extended_attempts(id,user_id) ON DELETE CASCADE);
CREATE INDEX extended_answers_owner ON public.extended_answers(user_id);
ALTER TABLE public.extended_attempts ENABLE ROW LEVEL SECURITY;ALTER TABLE public.extended_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.extended_attempts,public.extended_answers FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.extended_attempts,public.extended_answers TO service_role;
CREATE FUNCTION public.extended_select(p_id uuid,p_target integer) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.extended_attempts;q public.placement_test_questions;cat text;
BEGIN
 SELECT * INTO STRICT a FROM public.extended_attempts WHERE id=p_id;cat:=(ARRAY['grammar','vocabulary','reading'])[a.answered%3+1];
 SELECT * INTO q FROM public.placement_test_questions WHERE active AND category=cat AND NOT(id=ANY(a.served)) ORDER BY abs(public.placement_rank(level)-p_target),md5(id::text||p_id::text) LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'extended bank unavailable'; END IF;
 UPDATE public.extended_attempts SET current=to_jsonb(q),served=served||q.id WHERE id=p_id;
END $$;
CREATE FUNCTION public.extended_read(p_user uuid,p_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE a public.extended_attempts;history jsonb;review jsonb;
BEGIN
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required'; END IF;
 IF p_id IS NOT NULL THEN SELECT * INTO a FROM public.extended_attempts WHERE id=p_id AND user_id=p_user;IF NOT FOUND THEN RAISE EXCEPTION 'extended unavailable';END IF;
 ELSE SELECT * INTO a FROM public.extended_attempts WHERE user_id=p_user AND status='active'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'completedAt',completed_at,'result',result) ORDER BY completed_at DESC),'[]') INTO history FROM (SELECT * FROM public.extended_attempts WHERE user_id=p_user AND status='completed' ORDER BY completed_at DESC LIMIT 20) h;
 IF a.status='completed' THEN
  SELECT jsonb_agg(jsonb_build_object('position',position,'prompt',question->>'prompt','passage',question->>'passage','options',question->'options','selected',option_id,'correct',correct,'correctOption',question->>'correct_option','explanation',question->>'explanation','category',question->>'category','level',question->>'level') ORDER BY position) INTO review FROM public.extended_answers WHERE attempt_id=a.id;
 END IF;
 RETURN jsonb_build_object('id',a.id,'status',a.status,'answered',coalesce(a.answered,0),'total',36,'question',CASE WHEN a.current IS NOT NULL THEN jsonb_build_object('id',a.current->>'id','category',a.current->>'category','prompt',a.current->>'prompt','passage',a.current->>'passage','options',a.current->'options') END,'result',a.result,'review',coalesce(review,'[]'),'history',history,'recommendations',CASE WHEN a.status='completed' THEN (SELECT coalesce(jsonb_agg(to_jsonb(t)),'[]') FROM (SELECT l.id,l.title,coalesce(l.cefr_level,c.level) AS level FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE lang.code='en' AND public.can_access_lesson(p_user,l.id) ORDER BY abs(public.placement_rank(coalesce(l.cefr_level,c.level))-public.placement_rank(a.result->>'level')),l.id LIMIT 3)t) ELSE '[]'::jsonb END);
END $$;
CREATE FUNCTION public.extended_start(p_user uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE active_id uuid;
BEGIN
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required';END IF;
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT a.id INTO active_id FROM public.extended_attempts a WHERE a.user_id=p_user AND a.status='active';IF FOUND THEN RETURN public.extended_read(p_user,active_id);END IF;
 IF EXISTS(SELECT 1 FROM public.extended_attempts WHERE extended_attempts.id=p_request AND user_id=p_user) THEN RETURN public.extended_read(p_user,p_request);END IF;
 IF (SELECT count(*) FROM public.extended_attempts WHERE user_id=p_user AND created_at>now()-interval '24 hours')>=2 THEN RAISE EXCEPTION 'extended daily limit';END IF;
 IF (SELECT count(*) FROM (SELECT category FROM public.placement_test_questions WHERE active GROUP BY category HAVING count(*)>=12)t)<>3 THEN RAISE EXCEPTION 'extended bank unavailable';END IF;
 INSERT INTO public.extended_attempts(id,user_id) VALUES(p_request,p_user);PERFORM public.extended_select(p_request,coalesce(public.placement_rank(public.weak_level(p_user)),1));RETURN public.extended_read(p_user,p_request);
END $$;
CREATE FUNCTION public.extended_answer(p_user uuid,p_id uuid,p_request uuid,p_question uuid,p_option text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.extended_attempts;old public.extended_answers;ok boolean;weights float8[];prob float8;total float8;mean float8:=0;best integer:=1;lo integer:=6;hi integer:=6;cum float8:=0;rank integer;i integer;cat jsonb;
BEGIN
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required';END IF;
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO a FROM public.extended_attempts WHERE id=p_id AND user_id=p_user FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'extended unavailable';END IF;
 SELECT * INTO old FROM public.extended_answers WHERE attempt_id=p_id AND request_id=p_request;
 IF FOUND THEN IF old.question->>'id'<>p_question::text OR old.option_id<>p_option THEN RAISE EXCEPTION 'extended conflict';END IF;RETURN public.extended_read(p_user,p_id);END IF;
 IF a.status<>'active' OR a.current->>'id' IS DISTINCT FROM p_question::text THEN RAISE EXCEPTION 'extended conflict';END IF;
 IF p_request IS NULL OR p_option IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a.current->'options') WHERE value->>'id'=p_option) THEN RAISE EXCEPTION 'invalid extended answer';END IF;
 ok:=p_option=a.current->>'correct_option';rank:=public.placement_rank(a.current->>'level');
 INSERT INTO public.extended_answers VALUES(p_id,p_user,a.answered+1,p_request,a.current,p_option,ok);
 SELECT array_agg(value::float8 ORDER BY ord) INTO weights FROM jsonb_array_elements_text(a.posterior) WITH ORDINALITY t(value,ord);
 FOR i IN 1..6 LOOP prob:=0.25+0.72/(1+exp(-1.4*(i-rank)));weights[i]:=weights[i]*CASE WHEN ok THEN prob ELSE 1-prob END;END LOOP;
 SELECT sum(v) INTO total FROM unnest(weights)v;
 FOR i IN 1..6 LOOP weights[i]:=weights[i]/total;mean:=mean+i*weights[i];END LOOP;
 FOR i IN 2..6 LOOP IF weights[i]>weights[best] THEN best:=i;END IF;END LOOP;
 a.answered:=a.answered+1;
 UPDATE public.extended_attempts SET answered=a.answered,posterior=to_jsonb(weights) WHERE id=p_id;
 IF a.answered=36 THEN
  best:=least(best,(SELECT max(public.placement_rank(question->>'level')) FROM public.extended_answers WHERE attempt_id=p_id));
  IF best>=4 AND (SELECT count(*) FROM public.extended_answers WHERE attempt_id=p_id AND correct AND public.placement_rank(question->>'level')>=greatest(3,best-1))<4 THEN best:=3;END IF;
  FOR i IN 1..6 LOOP cum:=cum+weights[i];IF cum>=0.1 AND lo=6 THEN lo:=i;END IF;IF cum>=0.9 THEN hi:=i;EXIT;END IF;END LOOP;
  SELECT jsonb_object_agg(category,jsonb_build_object('answered',n,'correct',good,'accuracy',round(100.0*good/n,1))) INTO cat FROM (SELECT question->>'category' category,count(*) n,count(*) FILTER(WHERE correct) good FROM public.extended_answers WHERE attempt_id=p_id GROUP BY question->>'category')t;
  UPDATE public.extended_attempts SET status='completed',completed_at=now(),current=NULL,result=jsonb_build_object('level',(ARRAY['A1','A2','B1','B2','C1','C2'])[best],'from',(ARRAY['A1','A2','B1','B2','C1','C2'])[least(lo,best)],'to',(ARRAY['A1','A2','B1','B2','C1','C2'])[greatest(hi,best)],'confidence',round(weights[best]::numeric,3),'categories',cat,'algorithm','grid-irt-extended-v1','questions',36) WHERE id=p_id;
 ELSE PERFORM public.extended_select(p_id,CASE WHEN ok THEN least(rank+1,greatest(rank,round(mean)::integer)) ELSE greatest(1,least(rank-1,round(mean)::integer)) END);END IF;
 RETURN public.extended_read(p_user,p_id);
END $$;
CREATE FUNCTION public.premium_expansion_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$ SELECT jsonb_build_object('version','premium-expansion-v1','ready',(SELECT count(*)=3 AND bool_and(relrowsecurity) FROM pg_class WHERE oid IN('public.appearance_settings'::regclass,'public.extended_attempts'::regclass,'public.extended_answers'::regclass)) AND NOT has_function_privilege('authenticated','public.extended_answer(uuid,uuid,uuid,uuid,text)','EXECUTE') AND NOT has_function_privilege('anon','public.appearance_save(uuid,jsonb,integer)','EXECUTE')) $$;
REVOKE ALL ON FUNCTION public.appearance_public(uuid),public.appearance_read(uuid),public.appearance_save(uuid,jsonb,integer),public.extended_select(uuid,integer),public.extended_read(uuid,uuid),public.extended_start(uuid,uuid),public.extended_answer(uuid,uuid,uuid,uuid,text),public.premium_expansion_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.appearance_public(uuid),public.appearance_read(uuid),public.appearance_save(uuid,jsonb,integer),public.extended_select(uuid,integer),public.extended_read(uuid,uuid),public.extended_start(uuid,uuid),public.extended_answer(uuid,uuid,uuid,uuid,text),public.premium_expansion_status() TO service_role;
COMMIT;
