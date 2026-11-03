BEGIN;
ALTER TABLE public.courses ADD COLUMN learning_goals text[] NOT NULL DEFAULT ARRAY['general']::text[]
 CHECK(cardinality(learning_goals) BETWEEN 1 AND 5 AND learning_goals <@ ARRAY['general','communication','gaming','travel','study']::text[]);
UPDATE public.courses SET learning_goals=ARRAY['gaming'] WHERE slug ILIKE '%gaming%';
UPDATE public.courses SET learning_goals=ARRAY['communication','general'] WHERE slug ILIKE '%internet%';
CREATE TABLE public.learning_paths (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
 goal text NOT NULL DEFAULT 'general' CHECK(goal IN ('general','communication','gaming','travel','study')),
 selected_course_id uuid REFERENCES public.courses(id) ON DELETE SET NULL,
 preferences_revision bigint NOT NULL DEFAULT 0 CHECK(preferences_revision>=0),
 context_token text CHECK(context_token ~ '^[a-f0-9]{32}$'),
 plan_digest text CHECK(plan_digest ~ '^[a-f0-9]{32}$'),
 summary jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(summary)='object'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX learning_paths_course_idx ON public.learning_paths(selected_course_id);
CREATE TABLE public.learning_path_lessons (
 path_id uuid NOT NULL REFERENCES public.learning_paths(id) ON DELETE CASCADE,
 lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position BETWEEN 1 AND 12),
 reason text NOT NULL CHECK(reason IN ('practice','foundation','advance','goal','continue')),
 ready boolean NOT NULL,
 PRIMARY KEY(path_id,lesson_id), UNIQUE(path_id,position)
);
CREATE INDEX learning_path_lessons_lesson_idx ON public.learning_path_lessons(lesson_id);
CREATE INDEX learning_recent_completed_idx ON public.lesson_attempts(user_id,completed_at DESC,id) WHERE status='completed';
ALTER TABLE public.learning_paths ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_path_lessons ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.learning_paths,public.learning_path_lessons FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.learning_paths,public.learning_path_lessons TO service_role;

-- No new exercise-attempt or skill-assessment store: use existing graded submissions.
CREATE FUNCTION public.learning_path_context(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
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
  SELECT CASE WHEN kind IN ('grammar','gap','sentence') THEN 'grammar' WHEN kind='listening' THEN 'listening' ELSE 'vocabulary' END AS skill,correct FROM graded
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
  'recentSkills',coalesce((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.skill) FROM (SELECT skill,count(*) AS answered,count(*) FILTER(WHERE correct) AS correct FROM skill_rows GROUP BY skill) s),'[]'),
  'recentLessons',coalesce((SELECT jsonb_agg(jsonb_build_object('lessonId',a.lesson_id,'score',a.score,'level',c.level) ORDER BY a.completed_at DESC,a.id) FROM latest a JOIN public.lessons l ON l.id=a.lesson_id JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE lang.code='en'),'[]'),
  'lessons',coalesce((SELECT jsonb_agg(jsonb_build_object(
   'id',v.id,'title',v.title,'unitTitle',v.unit_title,'courseId',v.course_id,'courseTitle',v.course_title,'level',v.level,'goals',v.goals,
   'skills',coalesce((SELECT jsonb_agg(DISTINCT CASE WHEN e.kind IN ('grammar','gap','sentence') THEN 'grammar' WHEN e.kind='listening' THEN 'listening' ELSE 'vocabulary' END) FROM public.exercises e WHERE e.lesson_id=v.id AND (NOT e.premium_only OR public.has_premium(p_user))),'[]'),
   'prerequisites',coalesce((SELECT jsonb_agg(prev.id ORDER BY pu.position,prev.position) FROM public.lessons prev JOIN public.units pu ON pu.id=prev.unit_id WHERE pu.course_id=v.course_id AND prev.published AND (pu.position<v.unit_position OR (pu.position=v.unit_position AND prev.position<v.position))),'[]'),
   'bestScore',(SELECT p.best_score FROM public.user_progress p WHERE p.user_id=p_user AND p.lesson_id=v.id),
   'lastScore',(SELECT a.score FROM latest a WHERE a.lesson_id=v.id),
   'recentWrong',(SELECT count(*) FROM graded g WHERE g.lesson_id=v.id AND NOT g.correct)
  ) ORDER BY v.course_id,v.unit_position,v.position) FROM visible v),'[]')
 ) INTO body;
 RETURN jsonb_build_object('context',body,'token',md5(body::text));
END $$;

CREATE FUNCTION public.learning_path_preferences(p_user uuid,p_goal text,p_course uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_goal IS NULL OR p_goal NOT IN ('general','communication','gaming','travel','study') THEN RAISE EXCEPTION 'learning invalid preferences'; END IF;
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'learning unavailable'; END IF;
 IF p_course IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.courses c JOIN public.languages lang ON lang.id=c.language_id JOIN public.units u ON u.course_id=c.id JOIN public.lessons l ON l.unit_id=u.id WHERE c.id=p_course AND lang.code='en' AND public.can_access_lesson(p_user,l.id)) THEN RAISE EXCEPTION 'learning invalid course'; END IF;
 INSERT INTO public.learning_paths(user_id,goal,selected_course_id) VALUES(p_user,p_goal,p_course)
 ON CONFLICT(user_id) DO UPDATE SET goal=excluded.goal,selected_course_id=excluded.selected_course_id,preferences_revision=public.learning_paths.preferences_revision+1
 WHERE public.learning_paths.goal IS DISTINCT FROM excluded.goal OR public.learning_paths.selected_course_id IS DISTINCT FROM excluded.selected_course_id;
END $$;

CREATE FUNCTION public.learning_path_store(p_user uuid,p_token text,p_plan jsonb) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb; item jsonb; candidate jsonb; path uuid; pos integer:=0; seen uuid[]:=ARRAY[]::uuid[]; previous_id uuid;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'learning unavailable'; END IF;
 snapshot:=public.learning_path_context(p_user);
 IF p_token IS DISTINCT FROM snapshot->>'token' THEN RAISE EXCEPTION 'learning stale context'; END IF;
 IF jsonb_typeof(p_plan) IS DISTINCT FROM 'object' OR length(p_plan::text)>65536 OR p_plan->>'version' IS DISTINCT FROM 'rules-v1' OR jsonb_typeof(p_plan->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'items')>12 THEN RAISE EXCEPTION 'learning invalid plan'; END IF;
 IF p_plan->'level' IS DISTINCT FROM snapshot->'context'->'level' OR p_plan->'goal' IS DISTINCT FROM snapshot->'context'->'goal' OR p_plan->'courseId' IS DISTINCT FROM snapshot->'context'->'courseId' THEN RAISE EXCEPTION 'learning invalid plan'; END IF;
 INSERT INTO public.learning_paths(user_id) VALUES(p_user) ON CONFLICT(user_id) DO NOTHING;
 SELECT id INTO path FROM public.learning_paths WHERE user_id=p_user;
 -- Same inputs and algorithm produce no writes, even across concurrent requests.
 IF EXISTS(SELECT 1 FROM public.learning_paths WHERE id=path AND context_token=p_token AND plan_digest=md5(p_plan::text)) THEN RETURN path; END IF;
 DELETE FROM public.learning_path_lessons WHERE path_id=path;
 FOR item IN SELECT value FROM jsonb_array_elements(p_plan->'items') LOOP
  SELECT value INTO candidate FROM jsonb_array_elements(snapshot->'context'->'lessons') WHERE value->>'id'=item->>'id';
  IF candidate IS NULL OR (item->>'id')::uuid=ANY(seen) OR (snapshot->'context'->>'courseId' IS NOT NULL AND candidate->>'courseId'<>snapshot->'context'->>'courseId') THEN RAISE EXCEPTION 'learning invalid lesson'; END IF;
  FOR previous_id IN SELECT value::uuid FROM jsonb_array_elements_text(candidate->'prerequisites') LOOP
   IF NOT previous_id=ANY(seen) AND NOT EXISTS(SELECT 1 FROM public.user_progress WHERE user_id=p_user AND lesson_id=previous_id AND best_score>=60) THEN RAISE EXCEPTION 'learning invalid prerequisites'; END IF;
  END LOOP;
  pos:=pos+1;
  INSERT INTO public.learning_path_lessons(path_id,lesson_id,position,reason,ready) VALUES(path,(item->>'id')::uuid,pos,item->>'reason',(item->>'ready')::boolean);
  seen:=array_append(seen,(item->>'id')::uuid);
 END LOOP;
 UPDATE public.learning_paths SET summary=p_plan-'items',context_token=p_token,plan_digest=md5(p_plan::text),updated_at=now() WHERE id=path;
 RETURN path;
END $$;

CREATE FUNCTION public.learning_path_database_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ok boolean:=true; t text; f record;
BEGIN
 FOREACH t IN ARRAY ARRAY['learning_paths','learning_path_lessons'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity) OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN ok:=false; END IF;
 END LOOP;
 FOR f IN SELECT oid FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'learning_path_%' LOOP
  IF has_function_privilege('anon',f.oid,'EXECUTE') OR has_function_privilege('authenticated',f.oid,'EXECUTE') OR NOT has_function_privilege('service_role',f.oid,'EXECUTE') THEN ok:=false; END IF;
 END LOOP;
 RETURN jsonb_build_object('ready',ok,'version','rules-v1','tables',2);
END $$;
REVOKE ALL ON FUNCTION public.learning_path_context(uuid),public.learning_path_preferences(uuid,text,uuid),public.learning_path_store(uuid,text,jsonb),public.learning_path_database_status() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.learning_path_context(uuid),public.learning_path_preferences(uuid,text,uuid),public.learning_path_store(uuid,text,jsonb),public.learning_path_database_status() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
