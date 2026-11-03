BEGIN;
ALTER TABLE public.exercises DROP CONSTRAINT exercises_kind_check;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_kind_check CHECK(kind IN ('single_choice','multiple_choice','sentence','translation','gap','matching','word_order','error_identification','correction','context_choice','listening','dictation','reading','dialogue','response_choice','spelling','tenses','synonym_antonym','word_review','unit_test','grammar'));
ALTER FUNCTION public.lesson_public_payload(text,jsonb) RENAME TO lesson_public_payload_v1;
ALTER FUNCTION public.lesson_key_valid(text,jsonb,jsonb) RENAME TO lesson_key_valid_v1;
ALTER FUNCTION public.lesson_grade(text,jsonb,jsonb) RENAME TO lesson_grade_v1;
REVOKE ALL ON FUNCTION public.lesson_public_payload_v1(text,jsonb),public.lesson_key_valid_v1(text,jsonb,jsonb),public.lesson_grade_v1(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.exercise_items(v jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'array' OR jsonb_array_length(v) NOT BETWEEN 2 AND 30 THEN RAISE EXCEPTION 'invalid exercise items'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x) IS DISTINCT FROM 'object' OR jsonb_typeof(x->'id') IS DISTINCT FROM 'string' OR jsonb_typeof(x->'label') IS DISTINCT FROM 'string' OR length(x->>'id') NOT BETWEEN 1 AND 64 OR (x->>'id') !~ '^[a-zA-Z0-9_-]+$' OR length(trim(x->>'label')) NOT BETWEEN 1 AND 200) OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(v) x)<>jsonb_array_length(v) THEN RAISE EXCEPTION 'invalid exercise items'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',x->>'id','label',x->>'label') ORDER BY n) INTO result FROM jsonb_array_elements(v) WITH ORDINALITY s(x,n);
 RETURN result;
END $$;
CREATE FUNCTION public.exercise_text(v jsonb,max_size integer) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF jsonb_typeof(v) IS DISTINCT FROM 'string' OR length(trim(v#>>'{}')) NOT BETWEEN 1 AND max_size THEN RAISE EXCEPTION 'invalid exercise text'; END IF;
 RETURN v#>>'{}';
END $$;
CREATE FUNCTION public.lesson_public_payload(k text,p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE r jsonb; x jsonb; lines jsonb:='[]'; questions jsonb:='[]';
BEGIN
 IF k IN ('single_choice','sentence','gap','matching','grammar','listening') THEN RETURN public.lesson_public_payload_v1(k,p); END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR octet_length(p::text)>65536 THEN RAISE EXCEPTION 'invalid exercise content'; END IF;
 IF k IN ('word_order','spelling') THEN
  r:=jsonb_build_object('tokens',public.exercise_items(p->'tokens'));
  IF k='spelling' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r->'tokens') t WHERE (t->>'label') !~ '^[a-zA-Z]$') THEN RAISE EXCEPTION 'invalid spelling letters'; END IF;
  RETURN r;
 ELSIF k IN ('translation','correction','dictation') THEN
  IF k='dictation' AND p ? 'lang' AND (jsonb_typeof(p->'lang') IS DISTINCT FROM 'string' OR (p->>'lang') !~ '^[a-z]{2,3}(-[A-Z]{2})?$') THEN RAISE EXCEPTION 'invalid dictation language'; END IF;
  RETURN CASE k WHEN 'translation' THEN jsonb_build_object('source',public.exercise_text(p->'source',1000)) WHEN 'correction' THEN jsonb_build_object('sentence',public.exercise_text(p->'sentence',500)) ELSE jsonb_build_object('text',public.exercise_text(p->'text',500),'lang',coalesce(p->>'lang','en-US')) END;
 ELSIF k='unit_test' THEN
  IF jsonb_typeof(p->'questions') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'questions') NOT BETWEEN 2 AND 10 THEN RAISE EXCEPTION 'invalid checkpoint'; END IF;
  FOR x IN SELECT value FROM jsonb_array_elements(p->'questions') LOOP
   IF public.exercise_text(x->'id',64) !~ '^[a-zA-Z0-9_-]+$' THEN RAISE EXCEPTION 'invalid checkpoint id'; END IF;
   questions:=questions||jsonb_build_array(jsonb_build_object('id',x->>'id','prompt',public.exercise_text(x->'prompt',500),'options',public.exercise_items(x->'options')));
  END LOOP;
  IF (SELECT count(DISTINCT q->>'id') FROM jsonb_array_elements(questions) q)<>jsonb_array_length(questions) THEN RAISE EXCEPTION 'invalid checkpoint ids'; END IF;
  RETURN jsonb_build_object('questions',questions);
 ELSIF k IN ('multiple_choice','error_identification','context_choice','reading','dialogue','response_choice','tenses','synonym_antonym','word_review') THEN
  r:=jsonb_build_object('options',public.exercise_items(p->'options'));
  IF k IN ('error_identification','context_choice','tenses') THEN r:=r||jsonb_build_object('sentence',public.exercise_text(p->'sentence',500));
  ELSIF k='reading' THEN r:=r||jsonb_build_object('passage',public.exercise_text(p->'passage',5000));
  ELSIF k='response_choice' THEN r:=r||jsonb_build_object('context',public.exercise_text(p->'context',1000));
  ELSIF k IN ('synonym_antonym','word_review') THEN r:=r||jsonb_build_object('word',public.exercise_text(p->'word',200));
   IF k='synonym_antonym' THEN
    IF p->>'relation' IS NULL OR p->>'relation' NOT IN ('synonym','antonym') THEN RAISE EXCEPTION 'invalid word relation'; END IF;
    r:=r||jsonb_build_object('relation',p->>'relation');
   END IF;
  ELSIF k='dialogue' THEN
   IF jsonb_typeof(p->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'lines') NOT BETWEEN 1 AND 8 THEN RAISE EXCEPTION 'invalid dialogue'; END IF;
   FOR x IN SELECT value FROM jsonb_array_elements(p->'lines') LOOP
    lines:=lines||jsonb_build_array(jsonb_build_object('speaker',public.exercise_text(x->'speaker',40),'text',public.exercise_text(x->'text',400)));
   END LOOP;
   r:=r||jsonb_build_object('lines',lines);
  END IF;
  RETURN r;
 END IF;
 RAISE EXCEPTION 'invalid exercise kind';
END $$;

CREATE FUNCTION public.lesson_key_valid(k text,p jsonb,a jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE q jsonb;
BEGIN
 IF k IN ('single_choice','sentence','gap','matching','grammar','listening') THEN RETURN public.lesson_key_valid_v1(k,p,a); END IF;
 IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR octet_length(a::text)>16000 THEN RETURN false; END IF;
 IF k IN ('translation','correction','dictation') THEN
  IF jsonb_typeof(a->'accepted') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'accepted') NOT BETWEEN 1 AND 20 THEN RETURN false; END IF;
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'accepted') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string' OR length(trim(x#>>'{}')) NOT BETWEEN 1 AND 1000);
 ELSIF k IN ('multiple_choice','word_order','spelling') THEN
  IF jsonb_typeof(a->'value') IS DISTINCT FROM 'array' OR jsonb_array_length(a->'value')<1 THEN RETURN false; END IF;
  IF (SELECT count(DISTINCT v) FROM jsonb_array_elements(a->'value') v)<>jsonb_array_length(a->'value') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(a->'value') v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN k='multiple_choice' THEN p->'options' ELSE p->'tokens' END) t WHERE t->'id'=v)) THEN RETURN false; END IF;
  RETURN CASE WHEN k='multiple_choice' THEN jsonb_array_length(a->'value')>=2 ELSE jsonb_array_length(a->'value')=jsonb_array_length(p->'tokens') END;
 ELSIF k='unit_test' THEN
  IF jsonb_typeof(a->'answers') IS DISTINCT FROM 'object' OR jsonb_typeof(a->'explanations') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_each(a->'answers'))<>jsonb_array_length(p->'questions') OR (SELECT count(*) FROM jsonb_each(a->'explanations'))<>jsonb_array_length(p->'questions') THEN RETURN false; END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(p->'questions') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q->'options') o WHERE o->'id'=a->'answers'->(q->>'id')) OR jsonb_typeof(a->'explanations'->(q->>'id')) IS DISTINCT FROM 'string' OR length(trim(a->'explanations'->>(q->>'id'))) NOT BETWEEN 1 AND 1000 THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
 ELSIF k IN ('error_identification','context_choice','reading','dialogue','response_choice','tenses','synonym_antonym','word_review') THEN
  RETURN jsonb_typeof(a->'value')='string' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'options') o WHERE o->'id'=a->'value');
 END IF;
 RETURN false;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE FUNCTION public.exercise_normalize_text(v text) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text; pair jsonb;
BEGIN
 result:=lower(trim(regexp_replace(normalize(v,NFKC),'[[:space:]]+',' ','g')));
 result:=translate(result,'’‘ʼ',repeat(chr(39),3));
 result:=regexp_replace(result,'[.!?]+$','','g');
 FOR pair IN SELECT value FROM jsonb_array_elements('[ ["i''m","i am"],["you''re","you are"],["we''re","we are"],["they''re","they are"],["don''t","do not"],["doesn''t","does not"],["didn''t","did not"],["isn''t","is not"],["aren''t","are not"],["wasn''t","was not"],["weren''t","were not"],["can''t","cannot"],["won''t","will not"],["couldn''t","could not"],["shouldn''t","should not"],["wouldn''t","would not"],["haven''t","have not"],["hasn''t","has not"],["i''ve","i have"],["you''ve","you have"],["we''ve","we have"],["they''ve","they have"],["i''ll","i will"],["you''ll","you will"],["we''ll","we will"],["they''ll","they will"] ]'::jsonb) LOOP
  result:=regexp_replace(result,'\m'||(pair->>0)||'\M',pair->>1,'g');
 END LOOP;
 RETURN trim(result);
END $$;
CREATE FUNCTION public.lesson_grade(k text,key jsonb,answer jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF k IN ('single_choice','sentence','gap','matching','grammar','listening') THEN RETURN public.lesson_grade_v1(k,key,answer); END IF;
 IF k IN ('translation','correction','dictation') THEN RETURN jsonb_typeof(answer)='string' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(key->'accepted') x WHERE public.exercise_normalize_text(x)=public.exercise_normalize_text(answer#>>'{}'));
 ELSIF k='multiple_choice' THEN
  RETURN jsonb_typeof(answer)='array' AND jsonb_array_length(answer)=jsonb_array_length(key->'value') AND (SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements(answer) x)=(SELECT jsonb_agg(x ORDER BY x) FROM jsonb_array_elements(key->'value') x);
 ELSIF k='unit_test' THEN RETURN answer=key->'answers';
 ELSE RETURN answer=key->'value'; END IF;
END $$;
CREATE FUNCTION public.lesson_answer_valid(k text,p jsonb,a jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE q jsonb;
BEGIN
 IF k IN ('gap','translation','correction','dictation') THEN RETURN jsonb_typeof(a)='string' AND length(trim(a#>>'{}')) BETWEEN 1 AND CASE WHEN k='gap' THEN 200 ELSE 1000 END;
 ELSIF k='matching' THEN RETURN public.lesson_key_valid_v1(k,p,jsonb_build_object('pairs',a));
 ELSIF k IN ('sentence','word_order','spelling','multiple_choice') THEN
  IF jsonb_typeof(a) IS DISTINCT FROM 'array' OR jsonb_array_length(a) NOT BETWEEN 1 AND 30 OR (SELECT count(DISTINCT v) FROM jsonb_array_elements(a) v)<>jsonb_array_length(a) THEN RETURN false; END IF;
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a) v WHERE jsonb_typeof(v) IS DISTINCT FROM 'string' OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(CASE WHEN k='multiple_choice' THEN p->'options' ELSE p->'tokens' END) t WHERE t->'id'=v));
 ELSIF k='unit_test' THEN
  IF jsonb_typeof(a) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_each(a))<>jsonb_array_length(p->'questions') THEN RETURN false; END IF;
  FOR q IN SELECT value FROM jsonb_array_elements(p->'questions') LOOP
   IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(q->'options') o WHERE o->'id'=a->(q->>'id')) THEN RETURN false; END IF;
  END LOOP;
  RETURN true;
 ELSE RETURN jsonb_typeof(a)='string' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'options') o WHERE o->'id'=a); END IF;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION public.lesson_check_answer(k text,p jsonb,key jsonb,answer jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE actual jsonb; expected jsonb;
BEGIN
 IF NOT coalesce(public.lesson_answer_valid(k,p,answer),false) THEN RETURN false; END IF;
 IF k IN ('word_order','spelling') THEN
  SELECT jsonb_agg(t->'label' ORDER BY n) INTO actual FROM jsonb_array_elements_text(answer) WITH ORDINALITY a(id,n) JOIN LATERAL jsonb_array_elements(p->'tokens') t ON t->>'id'=a.id;
  SELECT jsonb_agg(t->'label' ORDER BY n) INTO expected FROM jsonb_array_elements_text(key->'value') WITH ORDINALITY a(id,n) JOIN LATERAL jsonb_array_elements(p->'tokens') t ON t->>'id'=a.id;
  RETURN actual=expected;
 END IF;
 RETURN coalesce(public.lesson_grade(k,key,answer),false);
END $$;

CREATE FUNCTION public.lesson_checked_feedback(k text,p jsonb,p_key jsonb,answer jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF k<>'unit_test' THEN RETURN '{}'::jsonb; END IF;
 RETURN jsonb_build_object('details',(SELECT jsonb_agg(jsonb_build_object('questionId',q.x->>'id','correct',answer->(q.x->>'id')=p_key->'answers'->(q.x->>'id'),'explanation',p_key->'explanations'->>(q.x->>'id')) ORDER BY q.n) FROM jsonb_array_elements(p->'questions') WITH ORDINALITY q(x,n)));
END $$;

CREATE OR REPLACE FUNCTION public.submit_lesson_answer_core(p_user uuid,p_attempt uuid,p_position integer,p_answer jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.lesson_attempts; item public.lesson_attempt_items; previous public.exercise_submissions; ok boolean; feedback text; total integer; done integer;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO a FROM public.lesson_attempts WHERE id=p_attempt AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'attempt unavailable'; END IF;
 IF p_answer IS NULL OR octet_length(p_answer::text)>4096 THEN RAISE EXCEPTION 'invalid answer'; END IF;
 SELECT * INTO previous FROM public.exercise_submissions WHERE attempt_id=a.id AND position=p_position;
 IF FOUND THEN
  IF previous.answer<>p_answer THEN RAISE EXCEPTION 'answer already submitted'; END IF;
  SELECT * INTO item FROM public.lesson_attempt_items WHERE attempt_id=a.id AND position=p_position;
  RETURN jsonb_build_object('correct',previous.correct,'explanation',previous.feedback,'state',public.lesson_state(p_user,p_attempt))||public.lesson_checked_feedback(item.kind,item.payload,item.answer_key,p_answer);
 END IF;
 IF a.status<>'started' THEN RAISE EXCEPTION 'attempt closed'; END IF;
 IF p_position<>(SELECT count(*)+1 FROM public.exercise_submissions WHERE attempt_id=a.id) THEN RAISE EXCEPTION 'answer out of order'; END IF;
 SELECT * INTO item FROM public.lesson_attempt_items WHERE attempt_id=a.id AND position=p_position;
 IF NOT FOUND THEN RAISE EXCEPTION 'exercise unavailable'; END IF;
 IF NOT coalesce(public.lesson_answer_valid(item.kind,item.payload,p_answer),false) THEN RAISE EXCEPTION 'invalid answer'; END IF;
 ok:=public.lesson_check_answer(item.kind,item.payload,item.answer_key,p_answer);
 feedback:=CASE WHEN item.explanation<>'' THEN item.explanation ELSE CASE WHEN ok THEN 'Ответ верный.' ELSE 'Ответ не совпал с ожидаемым. Повтори урок для закрепления.' END END;
 INSERT INTO public.exercise_submissions(attempt_id,position,answer,correct,feedback) VALUES(a.id,p_position,p_answer,ok,feedback);
 SELECT count(*) INTO total FROM public.lesson_attempt_items WHERE attempt_id=a.id;
 SELECT count(*) INTO done FROM public.exercise_submissions WHERE attempt_id=a.id;
 IF done=total THEN
  UPDATE public.lesson_attempts SET status='completed',completed_at=now(),score=(SELECT round(100.0*count(*) FILTER(WHERE correct)/total)::integer FROM public.exercise_submissions WHERE attempt_id=a.id) WHERE id=a.id;
  PERFORM public.award_completed_lesson(a.id);
 END IF;
 RETURN jsonb_build_object('correct',ok,'explanation',feedback,'state',public.lesson_state(p_user,p_attempt))||public.lesson_checked_feedback(item.kind,item.payload,item.answer_key,p_answer);
END $$;

CREATE FUNCTION public.learning_exercise_skill(k text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT CASE WHEN k IN ('grammar','gap','sentence','word_order','tenses','correction','error_identification') THEN 'grammar' WHEN k IN ('listening','dictation') THEN 'listening' WHEN k IN ('reading','dialogue','response_choice') THEN 'reading' WHEN k='unit_test' THEN NULL ELSE 'vocabulary' END
$$;

CREATE OR REPLACE FUNCTION public.learning_path_context(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE body jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user) THEN RAISE EXCEPTION 'learning unavailable'; END IF;
 WITH recent AS MATERIALIZED (
  SELECT id,lesson_id,score,completed_at FROM public.lesson_attempts WHERE user_id=p_user AND status='completed' ORDER BY completed_at DESC,id LIMIT 30
 ), latest AS MATERIALIZED (
  SELECT DISTINCT ON(lesson_id) * FROM recent ORDER BY lesson_id,completed_at DESC,id
 ), graded AS MATERIALIZED (
  SELECT a.lesson_id,i.kind,s.correct FROM latest a JOIN public.exercise_submissions s ON s.attempt_id=a.id JOIN public.lesson_attempt_items i ON i.attempt_id=s.attempt_id AND i.position=s.position
 ), skill_rows AS (
  SELECT public.learning_exercise_skill(kind) AS skill,correct FROM graded
 ), visible AS MATERIALIZED (
  SELECT l.id,l.title,l.position,u.position AS unit_position,u.title AS unit_title,c.id AS course_id,c.title AS course_title,c.level,
   c.learning_goals || CASE WHEN c.slug ILIKE '%gaming%' THEN ARRAY['gaming'] WHEN c.slug ILIKE '%internet%' THEN ARRAY['communication'] ELSE ARRAY[]::text[] END AS goals,
   u.id AS unit_id
  FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id
  WHERE lang.code='en' AND lang.active AND c.published AND l.published AND public.can_access_lesson(p_user,l.id)
  AND EXISTS(SELECT 1 FROM public.exercises e WHERE e.lesson_id=l.id AND (NOT e.premium_only OR public.has_premium(p_user)))
 )
 SELECT jsonb_build_object(
  'level',(SELECT coalesce(u.english_route_level,lev.level) FROM public.users u LEFT JOIN public.user_language_levels lev ON lev.user_id=u.id AND lev.language_id=(SELECT id FROM public.languages WHERE code='en') WHERE u.id=p_user),
  'goal',coalesce((SELECT goal FROM public.learning_paths WHERE user_id=p_user),'general'),
  'courseId',(SELECT selected_course_id FROM public.learning_paths p WHERE user_id=p_user AND EXISTS(SELECT 1 FROM visible v WHERE v.course_id=p.selected_course_id)),
  'revision',coalesce((SELECT preferences_revision FROM public.learning_paths WHERE user_id=p_user),0),
  'assessmentSkills',coalesce((SELECT jsonb_agg(jsonb_build_object('skill',a.category,'answered',a.answered,'correct',a.correct) ORDER BY a.category) FROM public.user_skill_assessments a JOIN public.languages lang ON lang.id=a.language_id JOIN public.user_language_levels lev ON lev.user_id=a.user_id AND lev.language_id=a.language_id AND lev.latest_attempt_id=a.attempt_id WHERE a.user_id=p_user AND lang.code='en'),'[]'),
  'recentSkills',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.skill) FROM (SELECT skill,count(*) AS answered,count(*) FILTER(WHERE correct) AS correct FROM skill_rows WHERE skill IS NOT NULL GROUP BY skill) s),'[]'),
  'recentLessons',coalesce((SELECT jsonb_agg(jsonb_build_object('lessonId',a.lesson_id,'score',a.score,'level',c.level) ORDER BY a.completed_at DESC,a.id) FROM latest a JOIN public.lessons l ON l.id=a.lesson_id JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE lang.code='en'),'[]'),
  'lessons',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',v.id,'title',v.title,'unitTitle',v.unit_title,'courseId',v.course_id,'courseTitle',v.course_title,'level',v.level,'goals',v.goals,
   'skills',coalesce((SELECT jsonb_agg(DISTINCT public.learning_exercise_skill(e.kind)) FILTER(WHERE public.learning_exercise_skill(e.kind) IS NOT NULL) FROM public.exercises e WHERE e.lesson_id=v.id AND (NOT e.premium_only OR public.has_premium(p_user))),'[]'),
   'prerequisites',coalesce((SELECT jsonb_agg(prev.id ORDER BY pu.position,prev.position) FROM public.lessons prev JOIN public.units pu ON pu.id=prev.unit_id WHERE pu.course_id=v.course_id AND prev.published AND (pu.position<v.unit_position OR (pu.position=v.unit_position AND prev.position<v.position))),'[]'),
   'bestScore',(SELECT p.best_score FROM public.user_progress p WHERE p.user_id=p_user AND p.lesson_id=v.id),
   'lastScore',(SELECT a.score FROM latest a WHERE a.lesson_id=v.id),
   'recentWrong',(SELECT count(*) FROM graded g WHERE g.lesson_id=v.id AND NOT g.correct)
  ) ORDER BY v.course_id,v.unit_position,v.position) FROM visible v),'[]')
 ) INTO body;
 RETURN jsonb_build_object('context',body,'token',md5(body::text));
END $$;

CREATE FUNCTION public.exercise_engine_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ok boolean:=true; f text; k text; constraint_text text;
BEGIN
 SELECT pg_get_constraintdef(oid) INTO constraint_text FROM pg_constraint WHERE conrelid='public.exercises'::regclass AND conname='exercises_kind_check';
 FOREACH k IN ARRAY ARRAY['single_choice','multiple_choice','sentence','translation','gap','matching','word_order','error_identification','correction','context_choice','listening','dictation','reading','dialogue','response_choice','spelling','tenses','synonym_antonym','word_review','unit_test','grammar'] LOOP
  IF constraint_text IS NULL OR strpos(constraint_text,quote_literal(k))=0 THEN ok:=false; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['public.exercise_items(jsonb)','public.exercise_text(jsonb,integer)','public.exercise_normalize_text(text)','public.lesson_answer_valid(text,jsonb,jsonb)','public.lesson_check_answer(text,jsonb,jsonb,jsonb)','public.lesson_checked_feedback(text,jsonb,jsonb,jsonb)','public.learning_exercise_skill(text)','public.lesson_public_payload(text,jsonb)','public.lesson_key_valid(text,jsonb,jsonb)','public.lesson_grade(text,jsonb,jsonb)','public.lesson_public_payload_v1(text,jsonb)','public.lesson_key_valid_v1(text,jsonb,jsonb)','public.lesson_grade_v1(text,jsonb,jsonb)','public.submit_lesson_answer_core(uuid,uuid,integer,jsonb)','public.exercise_engine_status()'] LOOP
  IF has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE') THEN ok:=false; END IF;
 END LOOP;
 IF has_function_privilege('service_role','public.submit_lesson_answer_core(uuid,uuid,integer,jsonb)','EXECUTE') OR NOT has_function_privilege('service_role','public.submit_lesson_answer(uuid,uuid,integer,jsonb)','EXECUTE') OR NOT has_function_privilege('service_role','public.exercise_engine_status()','EXECUTE') THEN ok:=false; END IF;
 RETURN jsonb_build_object('ready',ok,'version','interactive-v2','kinds',21);
END $$;
REVOKE ALL ON FUNCTION public.exercise_items(jsonb),public.exercise_text(jsonb,integer),public.exercise_normalize_text(text),public.lesson_answer_valid(text,jsonb,jsonb),public.lesson_check_answer(text,jsonb,jsonb,jsonb),public.lesson_checked_feedback(text,jsonb,jsonb,jsonb),public.learning_exercise_skill(text),public.lesson_public_payload(text,jsonb),public.lesson_key_valid(text,jsonb,jsonb),public.lesson_grade(text,jsonb,jsonb),public.exercise_engine_status() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.lesson_public_payload(text,jsonb),public.lesson_key_valid(text,jsonb,jsonb),public.lesson_grade(text,jsonb,jsonb),public.exercise_engine_status() TO service_role;
REVOKE ALL ON FUNCTION public.submit_lesson_answer_core(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.exercise_items(jsonb),public.exercise_text(jsonb,integer),public.exercise_normalize_text(text),public.lesson_answer_valid(text,jsonb,jsonb),public.lesson_check_answer(text,jsonb,jsonb,jsonb),public.lesson_checked_feedback(text,jsonb,jsonb,jsonb),public.learning_exercise_skill(text),public.lesson_public_payload_v1(text,jsonb),public.lesson_key_valid_v1(text,jsonb,jsonb),public.lesson_grade_v1(text,jsonb,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
