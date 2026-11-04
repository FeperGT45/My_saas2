BEGIN;
CREATE TABLE public.weak_runs (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 topic_id uuid NOT NULL REFERENCES public.lessons(id), title text NOT NULL, level text NOT NULL,
 status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','abandoned')),
 baseline_accuracy numeric NOT NULL, after_accuracy numeric,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, UNIQUE(id,user_id)
);
CREATE UNIQUE INDEX weak_active_user ON public.weak_runs(user_id) WHERE status='started';
CREATE INDEX weak_runs_topic ON public.weak_runs(topic_id);
CREATE INDEX weak_runs_user ON public.weak_runs(user_id,created_at DESC);
CREATE INDEX weak_runs_history ON public.weak_runs(user_id,completed_at DESC,id) WHERE status='completed';
CREATE TABLE public.weak_items (
 run_id uuid NOT NULL REFERENCES public.weak_runs(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 6), exercise_id uuid NOT NULL,
 variant text NOT NULL, kind text NOT NULL, prompt text NOT NULL, payload jsonb NOT NULL,
 answer_key jsonb NOT NULL, explanation text NOT NULL, baseline_wrong boolean NOT NULL, is_new boolean NOT NULL,
 PRIMARY KEY(run_id,position), UNIQUE(run_id,exercise_id)
);
CREATE INDEX weak_items_exercise ON public.weak_items(exercise_id,run_id);
CREATE INDEX weak_lesson_items_exercise ON public.lesson_attempt_items(exercise_id,attempt_id);
CREATE TABLE public.weak_answers (
 run_id uuid NOT NULL, position integer NOT NULL, request_id uuid NOT NULL,
 answer jsonb NOT NULL, correct boolean NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(run_id,position), UNIQUE(run_id,request_id),
 FOREIGN KEY(run_id,position) REFERENCES public.weak_items(run_id,position) ON DELETE CASCADE
);
ALTER TABLE public.weak_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weak_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weak_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weak_runs,public.weak_items,public.weak_answers FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.weak_runs,public.weak_items,public.weak_answers TO service_role;
GRANT SELECT ON public.weak_runs TO authenticated;
CREATE POLICY weak_runs_owner ON public.weak_runs FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

-- Preserve normal lesson XP and integrate bounded improvement XP into the existing total/leaderboard.
ALTER TABLE public.xp_events ALTER COLUMN lesson_id DROP NOT NULL;
ALTER TABLE public.xp_events ALTER COLUMN attempt_id DROP NOT NULL;
ALTER TABLE public.xp_events ADD COLUMN training_exercise_id uuid REFERENCES public.exercises(id);
ALTER TABLE public.xp_events ADD COLUMN weak_run_id uuid;
ALTER TABLE public.xp_events ADD CONSTRAINT xp_weak_run_owner FOREIGN KEY(weak_run_id,user_id) REFERENCES public.weak_runs(id,user_id);
ALTER TABLE public.xp_events ADD CONSTRAINT xp_origin_valid CHECK(
 (training_exercise_id IS NULL AND weak_run_id IS NULL AND lesson_id IS NOT NULL AND attempt_id IS NOT NULL)
 OR (training_exercise_id IS NOT NULL AND weak_run_id IS NOT NULL AND lesson_id IS NULL AND attempt_id IS NULL AND amount=5));
CREATE UNIQUE INDEX weak_xp_once ON public.xp_events(user_id,training_exercise_id) WHERE training_exercise_id IS NOT NULL;
CREATE INDEX weak_xp_run_owner ON public.xp_events(weak_run_id,user_id) WHERE weak_run_id IS NOT NULL;
CREATE INDEX weak_xp_exercise ON public.xp_events(training_exercise_id) WHERE training_exercise_id IS NOT NULL;
-- Training rewards are XP, not completed lessons or daily lesson quests.
DO $$ DECLARE f text; definition text; patched text; BEGIN
 FOREACH f IN ARRAY ARRAY['public.game_summary(uuid)','public.award_completed_lesson(uuid)'] LOOP
  definition:=pg_get_functiondef(f::regprocedure);
  patched:=replace(definition,'SELECT count(*) INTO daily FROM public.xp_events WHERE user_id=',
   'SELECT count(*) INTO daily FROM public.xp_events WHERE training_exercise_id IS NULL AND user_id=');
  IF patched=definition THEN RAISE EXCEPTION 'weak XP compatibility patch unavailable'; END IF;
  EXECUTE patched;
 END LOOP;
END $$;

CREATE FUNCTION public.weak_level(p_user uuid) RETURNS text LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(u.english_route_level,(SELECT lev.level FROM public.user_language_levels lev JOIN public.languages l ON l.id=lev.language_id WHERE lev.user_id=p_user AND l.code='en'),'A1') FROM public.users u WHERE u.id=p_user
$$;
CREATE FUNCTION public.weak_variant(k text,prompt text,p jsonb,key jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT md5(jsonb_build_array(k,prompt,p,key)::text) $$;
CREATE FUNCTION public.weak_material(p_user uuid) RETURNS TABLE(exercise_id uuid,topic_id uuid,title text,level text,kind text,prompt text,payload jsonb,answer_key jsonb,explanation text,variant text)
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE row record; p jsonb; key jsonb;
BEGIN
 FOR row IN SELECT e.*,l.title AS topic_title,coalesce(l.cefr_level,c.level) AS cefr FROM public.exercises e JOIN public.lessons l ON l.id=e.lesson_id JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id
 WHERE l.published AND NOT l.retired_audio AND lang.code='en' AND lang.active AND c.published AND public.can_access_lesson(p_user,l.id)
 AND e.kind NOT IN ('listening','dictation','unit_test') AND (NOT e.premium_only OR public.has_feature(p_user,'extra_exercises'))
 AND array_position(ARRAY['A1','A2','B1','B2','C1','C2'],coalesce(l.cefr_level,c.level))<=array_position(ARRAY['A1','A2','B1','B2','C1','C2'],public.weak_level(p_user)) LOOP
  BEGIN
   p:=row.public_payload; key:=row.answer_key;
   IF row.kind='single_choice' AND p='{}' THEN
    SELECT jsonb_build_object('options',jsonb_agg(jsonb_build_object('id',o.id::text,'label',o.label) ORDER BY o.position)) INTO p FROM public.exercise_options o WHERE o.exercise_id=row.id;
    SELECT jsonb_build_object('value',o.id::text) INTO key FROM public.exercise_options o WHERE o.exercise_id=row.id AND o.is_correct;
   END IF;
   p:=public.lesson_public_payload(row.kind,p);
   IF coalesce(public.lesson_key_valid(row.kind,p,key),false) THEN
    exercise_id:=row.id; topic_id:=row.lesson_id; title:=row.topic_title; level:=row.cefr; kind:=row.kind; prompt:=row.prompt; payload:=p; answer_key:=key; explanation:=row.explanation;
    variant:=public.weak_variant(row.kind,row.prompt,p,key); RETURN NEXT;
   END IF;
  EXCEPTION WHEN OTHERS THEN CONTINUE; END;
 END LOOP;
END $$;
CREATE FUNCTION public.weak_observations(p_user uuid) RETURNS TABLE(exercise_id uuid,variant text,correct boolean,answered_at timestamptz)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH recent AS MATERIALIZED (SELECT id,completed_at FROM public.lesson_attempts WHERE user_id=p_user AND status='completed' AND completed_at>=now()-interval '90 days' ORDER BY completed_at DESC,id DESC LIMIT 100),
 practices AS MATERIALIZED (SELECT id,completed_at FROM public.weak_runs WHERE user_id=p_user AND status='completed' AND completed_at>=now()-interval '90 days' ORDER BY completed_at DESC,id DESC LIMIT 100),
 events AS (
  SELECT i.exercise_id,public.weak_variant(i.kind,i.prompt,i.payload,i.answer_key) AS variant,s.correct,a.completed_at AS answered_at,a.id AS source
  FROM recent a JOIN public.lesson_attempt_items i ON i.attempt_id=a.id JOIN public.exercise_submissions s ON s.attempt_id=i.attempt_id AND s.position=i.position
  UNION ALL
  SELECT i.exercise_id,i.variant,s.correct,a.completed_at,a.id FROM practices a JOIN public.weak_items i ON i.run_id=a.id JOIN public.weak_answers s ON s.run_id=i.run_id AND s.position=i.position
 ) SELECT DISTINCT ON(exercise_id,variant) exercise_id,variant,correct,answered_at FROM events ORDER BY exercise_id,variant,answered_at DESC,source DESC
$$;
CREATE FUNCTION public.weak_analysis(p_user uuid) RETURNS TABLE(topic_id uuid,title text,level text,answered bigint,wrong bigint,accuracy numeric,state text,available bigint)
LANGUAGE sql STABLE SET search_path='' AS $$
 WITH m AS MATERIALIZED(SELECT * FROM public.weak_material(p_user)),o AS MATERIALIZED(SELECT * FROM public.weak_observations(p_user)),
 stats AS(SELECT m.topic_id,m.title,m.level,count(o.exercise_id) AS answered,count(*) FILTER(WHERE o.correct=false) AS wrong,round(100.0*count(*) FILTER(WHERE o.correct)/nullif(count(o.exercise_id),0),1) AS accuracy,count(*) AS available FROM m LEFT JOIN o ON o.exercise_id=m.exercise_id AND o.variant=m.variant GROUP BY m.topic_id,m.title,m.level)
 SELECT topic_id,title,level,answered,wrong,accuracy,CASE WHEN answered<5 THEN 'insufficient' WHEN accuracy>=80 THEN 'mastered' WHEN accuracy<=60 AND wrong>=2 THEN 'weak' ELSE 'developing' END AS state,available FROM stats
$$;
-- Explicit column ordering keeps the browser status separate from the material count.
CREATE FUNCTION public.weak_enough(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT (SELECT count(DISTINCT a.lesson_id)>=2 FROM public.lesson_attempts a JOIN public.lessons l ON l.id=a.lesson_id JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE a.user_id=p_user AND a.status='completed' AND a.completed_at>=now()-interval '90 days' AND lang.code='en')
 AND (SELECT count(*)>=10 FROM public.weak_observations(p_user) o JOIN public.weak_material(p_user) m ON m.exercise_id=o.exercise_id AND m.variant=o.variant)
$$;
CREATE FUNCTION public.weak_dashboard(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE topics jsonb; history jsonb; enough boolean;
BEGIN
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RETURN jsonb_build_object('premium',false,'level',NULL,'enough',false,'topics','[]'::jsonb,'history','[]'::jsonb,'activeId',NULL); END IF;
 enough:=public.weak_enough(p_user);
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',topic_id,'title',title,'level',level,'answered',answered,'wrong',wrong,'accuracy',accuracy,'status',state,'available',available) ORDER BY CASE state WHEN 'weak' THEN 0 WHEN 'developing' THEN 1 WHEN 'insufficient' THEN 2 ELSE 3 END,accuracy,title),'[]') INTO topics FROM public.weak_analysis(p_user);
 SELECT coalesce(jsonb_agg(body ORDER BY completed_at DESC,id DESC),'[]') INTO history FROM (SELECT r.id,r.completed_at,jsonb_build_object('id',r.id,'title',r.title,'completedAt',r.completed_at,'before',r.baseline_accuracy,'after',r.after_accuracy,'xp',(SELECT coalesce(sum(amount),0) FROM public.xp_events x WHERE x.weak_run_id=r.id)) AS body FROM public.weak_runs r WHERE r.user_id=p_user AND r.status='completed' ORDER BY r.completed_at DESC,r.id DESC LIMIT 20) h;
 RETURN jsonb_build_object('premium',true,'level',public.weak_level(p_user),'enough',enough,'topics',topics,'history',history,'activeId',(SELECT id FROM public.weak_runs WHERE user_id=p_user AND status='started'));
END $$;
CREATE FUNCTION public.weak_state(p_user uuid,p_run uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE r public.weak_runs; item public.weak_items; total integer; done integer; good integer; access boolean;
BEGIN
 SELECT * INTO r FROM public.weak_runs WHERE id=p_run AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'weak unavailable'; END IF;
 access:=public.has_feature(p_user,'extra_exercises') AND public.can_access_lesson(p_user,r.topic_id);
 SELECT count(*) INTO total FROM public.weak_items WHERE run_id=r.id;
 SELECT count(*),count(*) FILTER(WHERE correct) INTO done,good FROM public.weak_answers WHERE run_id=r.id;
 SELECT * INTO item FROM public.weak_items i WHERE i.run_id=r.id AND NOT EXISTS(SELECT 1 FROM public.weak_answers a WHERE a.run_id=i.run_id AND a.position=i.position) ORDER BY position LIMIT 1;
 RETURN jsonb_build_object('id',r.id,'topicId',r.topic_id,'title',r.title,'level',r.level,'status',r.status,'accessible',access,'total',total,'answered',done,'correct',good,'score',CASE WHEN r.status='completed' THEN round(100.0*good/nullif(total,0),1) END,
 'before',r.baseline_accuracy,'after',r.after_accuracy,'xp',(SELECT coalesce(sum(amount),0) FROM public.xp_events WHERE weak_run_id=r.id),
 'recovered',(SELECT count(*) FROM public.weak_items i JOIN public.weak_answers a ON a.run_id=i.run_id AND a.position=i.position WHERE i.run_id=r.id AND i.baseline_wrong AND a.correct),
 'exercise',CASE WHEN access AND r.status='started' AND item.position IS NOT NULL THEN jsonb_build_object('position',item.position,'kind',item.kind,'prompt',item.prompt,'payload',item.payload,'isNew',item.is_new,'wasWrong',item.baseline_wrong) END);
END $$;
CREATE FUNCTION public.weak_start(p_user uuid,p_topic uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.weak_runs; chosen record; n integer; total integer;
BEGIN
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required'; END IF;
 IF p_request IS NULL THEN RAISE EXCEPTION 'invalid weak request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':weak',0));
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO r FROM public.weak_runs WHERE id=p_request;
 IF FOUND THEN
  IF r.user_id<>p_user OR (p_topic IS NOT NULL AND r.topic_id<>p_topic) THEN RAISE EXCEPTION 'weak conflict'; END IF;
  RETURN public.weak_state(p_user,r.id);
 END IF;
 IF NOT public.weak_enough(p_user) THEN RAISE EXCEPTION 'weak insufficient history'; END IF;
 SELECT * INTO chosen FROM public.weak_analysis(p_user) WHERE (p_topic IS NULL AND state='weak') OR (topic_id=p_topic AND state IN('weak','developing')) ORDER BY accuracy,wrong DESC,topic_id LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'weak no eligible topic'; END IF;
 UPDATE public.weak_runs SET status='abandoned' WHERE user_id=p_user AND status='started';
 INSERT INTO public.weak_runs(id,user_id,topic_id,title,level,baseline_accuracy) VALUES(p_request,p_user,chosen.topic_id,chosen.title,chosen.level,chosen.accuracy);
 WITH observations AS MATERIALIZED(SELECT * FROM public.weak_observations(p_user)),
 seen AS MATERIALIZED(
  SELECT i.exercise_id FROM public.lesson_attempts a JOIN public.exercise_submissions s ON s.attempt_id=a.id JOIN public.lesson_attempt_items i ON i.attempt_id=s.attempt_id AND i.position=s.position WHERE a.user_id=p_user AND a.status='completed'
  UNION SELECT i.exercise_id FROM public.weak_runs practice JOIN public.weak_answers a ON a.run_id=practice.id JOIN public.weak_items i ON i.run_id=a.run_id AND i.position=a.position WHERE practice.user_id=p_user AND practice.status='completed'
 ), candidates AS MATERIALIZED(
  SELECT m.*,coalesce(o.correct=false,false) AS was_wrong,NOT EXISTS(SELECT 1 FROM seen WHERE seen.exercise_id=m.exercise_id) AS is_new
  FROM public.weak_material(p_user) m LEFT JOIN observations o ON o.exercise_id=m.exercise_id AND o.variant=m.variant WHERE m.topic_id=chosen.topic_id
 ), ranked AS(SELECT *,row_number() OVER(PARTITION BY was_wrong ORDER BY md5(exercise_id::text||p_request::text)) AS group_rank FROM candidates WHERE was_wrong OR is_new),
 selected AS(SELECT * FROM ranked ORDER BY CASE WHEN group_rank<=3 THEN 0 ELSE 1 END,was_wrong DESC,group_rank LIMIT 6)
 INSERT INTO public.weak_items(run_id,position,exercise_id,variant,kind,prompt,payload,answer_key,explanation,baseline_wrong,is_new)
 SELECT p_request,row_number() OVER(ORDER BY group_rank,was_wrong DESC),exercise_id,variant,kind,prompt,payload,answer_key,explanation,was_wrong,is_new FROM selected;
 SELECT count(*) INTO total FROM public.weak_items WHERE run_id=p_request;
 IF total<2 OR NOT EXISTS(SELECT 1 FROM public.weak_items WHERE run_id=p_request AND baseline_wrong) THEN RAISE EXCEPTION 'weak no materials'; END IF;
 RETURN public.weak_state(p_user,p_request);
END $$;
CREATE FUNCTION public.weak_answer(p_user uuid,p_run uuid,p_request uuid,p_position integer,p_answer jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE r public.weak_runs; item public.weak_items; previous public.weak_answers; ok boolean; done integer; total integer; details jsonb;
BEGIN
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required'; END IF;
 IF p_request IS NULL OR p_answer IS NULL OR octet_length(p_answer::text)>4096 THEN RAISE EXCEPTION 'invalid weak answer'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':weak',0));
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO r FROM public.weak_runs WHERE id=p_run AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'weak unavailable'; END IF;
 IF NOT public.can_access_lesson(p_user,r.topic_id) THEN RAISE EXCEPTION 'weak unavailable'; END IF;
 SELECT * INTO previous FROM public.weak_answers WHERE run_id=p_run AND (position=p_position OR request_id=p_request) LIMIT 1;
 IF FOUND THEN
  IF previous.position<>p_position OR previous.request_id<>p_request OR previous.answer<>p_answer THEN RAISE EXCEPTION 'weak conflict'; END IF;
  SELECT * INTO item FROM public.weak_items WHERE run_id=p_run AND position=p_position;
  RETURN jsonb_build_object('correct',previous.correct,'explanation',item.explanation,'state',public.weak_state(p_user,p_run))||public.lesson_checked_feedback(item.kind,item.payload,item.answer_key,p_answer);
 END IF;
 SELECT count(*) INTO done FROM public.weak_answers WHERE run_id=p_run;
 IF r.status<>'started' OR p_position IS NULL OR p_position<>done+1 THEN RAISE EXCEPTION 'weak conflict'; END IF;
 SELECT * INTO item FROM public.weak_items WHERE run_id=p_run AND position=p_position;
 IF NOT FOUND THEN RAISE EXCEPTION 'weak unavailable'; END IF;
 IF NOT coalesce(public.lesson_answer_valid(item.kind,item.payload,p_answer),false) THEN RAISE EXCEPTION 'invalid weak answer'; END IF;
 ok:=public.lesson_check_answer(item.kind,item.payload,item.answer_key,p_answer);
 INSERT INTO public.weak_answers(run_id,position,request_id,answer,correct) VALUES(p_run,p_position,p_request,p_answer,ok);
 SELECT count(*) INTO total FROM public.weak_items WHERE run_id=p_run;
 IF done+1=total THEN
  UPDATE public.weak_runs SET status='completed',completed_at=now() WHERE id=p_run;
  UPDATE public.weak_runs SET after_accuracy=(SELECT accuracy FROM public.weak_analysis(p_user) WHERE topic_id=r.topic_id) WHERE id=p_run;
  INSERT INTO public.xp_events(user_id,training_exercise_id,weak_run_id,amount)
  SELECT p_user,i.exercise_id,p_run,5 FROM public.weak_items i JOIN public.weak_answers a ON a.run_id=i.run_id AND a.position=i.position
   JOIN public.weak_material(p_user) m ON m.exercise_id=i.exercise_id AND m.variant=i.variant
   WHERE i.run_id=p_run AND i.baseline_wrong AND a.correct
  ON CONFLICT(user_id,training_exercise_id) WHERE training_exercise_id IS NOT NULL DO NOTHING;
 END IF;
 RETURN jsonb_build_object('correct',ok,'explanation',CASE WHEN item.explanation='' THEN CASE WHEN ok THEN 'Ответ верный.' ELSE 'Ответ не совпал с ожидаемым.' END ELSE item.explanation END,'state',public.weak_state(p_user,p_run))||public.lesson_checked_feedback(item.kind,item.payload,item.answer_key,p_answer);
END $$;
CREATE FUNCTION public.weak_database_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','weak-v1','ready',
 (SELECT count(*)=3 AND bool_and(relrowsecurity) FROM pg_class WHERE oid IN('public.weak_runs'::regclass,'public.weak_items'::regclass,'public.weak_answers'::regclass))
 AND NOT has_function_privilege('anon','public.weak_start(uuid,uuid,uuid)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.weak_answer(uuid,uuid,uuid,integer,jsonb)','EXECUTE')
 AND NOT has_table_privilege('authenticated','public.weak_items','SELECT')
 AND EXISTS(SELECT 1 FROM pg_index WHERE indexrelid='public.weak_xp_once'::regclass AND indisunique))
$$;
REVOKE ALL ON FUNCTION public.weak_level(uuid),public.weak_variant(text,text,jsonb,jsonb),public.weak_material(uuid),public.weak_observations(uuid),public.weak_analysis(uuid),public.weak_enough(uuid),public.weak_dashboard(uuid),public.weak_state(uuid,uuid),public.weak_start(uuid,uuid,uuid),public.weak_answer(uuid,uuid,uuid,integer,jsonb),public.weak_database_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weak_level(uuid),public.weak_variant(text,text,jsonb,jsonb),public.weak_material(uuid),public.weak_observations(uuid),public.weak_analysis(uuid),public.weak_enough(uuid),public.weak_dashboard(uuid),public.weak_state(uuid,uuid),public.weak_start(uuid,uuid,uuid),public.weak_answer(uuid,uuid,uuid,integer,jsonb),public.weak_database_status() TO service_role;
COMMIT;
