BEGIN;
-- Telegram sessions are verified in the server. Browser roles never read or write these tables/RPCs.
CREATE TABLE public.weekly_plans (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 starts_on date NOT NULL, time_zone text NOT NULL, goal text NOT NULL CHECK(goal IN ('general','communication','gaming','travel','study')),
 minutes integer NOT NULL CHECK(minutes IN (5,10,15,20)), revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
 context_token text, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,starts_on)
);
CREATE TABLE public.weekly_plan_days (
 plan_id uuid NOT NULL REFERENCES public.weekly_plans(id) ON DELETE CASCADE,
 day_index integer NOT NULL CHECK(day_index BETWEEN 0 AND 6), scheduled_on date NOT NULL,
 PRIMARY KEY(plan_id,day_index), UNIQUE(plan_id,scheduled_on) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE public.weekly_plan_tasks (
 plan_id uuid NOT NULL, day_index integer NOT NULL, position integer NOT NULL CHECK(position BETWEEN 0 AND 3),
 lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 500),
 kind text NOT NULL CHECK(kind IN ('lesson','practice')), minutes integer NOT NULL DEFAULT 5 CHECK(minutes=5), ready boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz, attempt_id uuid UNIQUE REFERENCES public.lesson_attempts(id) ON DELETE SET NULL,
 PRIMARY KEY(plan_id,day_index,position), FOREIGN KEY(plan_id,day_index) REFERENCES public.weekly_plan_days(plan_id,day_index) ON DELETE CASCADE
);
CREATE INDEX weekly_plan_tasks_lesson_idx ON public.weekly_plan_tasks(lesson_id);
ALTER TABLE public.weekly_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_plan_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weekly_plan_tasks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.weekly_plans,public.weekly_plan_days,public.weekly_plan_tasks FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.weekly_plans,public.weekly_plan_days,public.weekly_plan_tasks TO service_role;

CREATE FUNCTION public.weekly_plan_view(p_id uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('id',p.id,'start',p.starts_on,'today',(now() AT TIME ZONE p.time_zone)::date,'timeZone',p.time_zone,
 'goal',p.goal,'minutes',p.minutes,'revision',p.revision,'days',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'index',d.day_index,'date',d.scheduled_on,'tasks',coalesce((SELECT jsonb_agg(jsonb_build_object('position',t.position,'lessonId',t.lesson_id,
 'title',t.title,'kind',t.kind,'minutes',t.minutes,'ready',t.ready,'completedAt',t.completed_at) ORDER BY t.position)
 FROM public.weekly_plan_tasks t WHERE t.plan_id=d.plan_id AND t.day_index=d.day_index),'[]'::jsonb)) ORDER BY d.day_index)
 FROM public.weekly_plan_days d WHERE d.plan_id=p.id),'[]'::jsonb)) FROM public.weekly_plans p WHERE p.id=p_id
$$;
CREATE FUNCTION public.weekly_plan_snapshot(p_user uuid,p_goal text DEFAULT NULL,p_minutes integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.weekly_plans; ctx jsonb; tz text; today date;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'weekly unavailable'; END IF;
 IF NOT public.has_feature(p_user,'lesson_review_plan') THEN RAISE EXCEPTION 'premium required'; END IF;
 IF (p_goal IS NOT NULL AND p_goal NOT IN ('general','communication','gaming','travel','study')) OR (p_minutes IS NOT NULL AND p_minutes NOT IN(5,10,15,20)) THEN RAISE EXCEPTION 'weekly invalid preferences'; END IF;
 SELECT time_zone INTO tz FROM public.users WHERE id=p_user;
 SELECT * INTO p FROM public.weekly_plans WHERE user_id=p_user ORDER BY starts_on DESC LIMIT 1 FOR UPDATE;
 -- Freeze a week's timezone so a later profile change cannot redate completed work.
 IF p.id IS NOT NULL THEN tz:=p.time_zone; END IF;
 today:=(now() AT TIME ZONE tz)::date;
 ctx:=public.learning_path_context(p_user);
 IF ctx->'context'->>'level' IS NULL THEN RAISE EXCEPTION 'weekly level required'; END IF;
 IF p.id IS NULL OR today>p.starts_on+6 THEN
  SELECT time_zone INTO tz FROM public.users WHERE id=p_user;
  today:=(now() AT TIME ZONE tz)::date;
  INSERT INTO public.weekly_plans(user_id,starts_on,time_zone,goal,minutes)
  VALUES(p_user,today,tz,coalesce(p_goal,p.goal,ctx->'context'->>'goal','general'),coalesce(p_minutes,p.minutes,10))
  ON CONFLICT(user_id,starts_on) DO UPDATE SET user_id=excluded.user_id RETURNING * INTO p;
  INSERT INTO public.weekly_plan_days(plan_id,day_index,scheduled_on) SELECT p.id,n,today+n FROM generate_series(0,6) n ON CONFLICT(plan_id,day_index) DO NOTHING;
 END IF;
 IF (p_goal IS NOT NULL AND p_goal<>p.goal) OR (p_minutes IS NOT NULL AND p_minutes<>p.minutes) THEN
  UPDATE public.weekly_plans SET goal=coalesce(p_goal,goal),minutes=coalesce(p_minutes,minutes),revision=revision+1,context_token=NULL WHERE id=p.id RETURNING * INTO p;
 END IF;
 RETURN jsonb_build_object('plan',public.weekly_plan_view(p.id),'context',ctx->'context','token',ctx->>'token','needsRebuild',p.context_token IS DISTINCT FROM ctx->>'token');
END $$;
CREATE FUNCTION public.weekly_plan_store(p_user uuid,p_id uuid,p_revision integer,p_token text,p_days jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.weekly_plans; d jsonb; t jsonb; n integer; pos integer; snapshot jsonb; candidate jsonb; seen integer[]:=ARRAY[]::integer[]; positions integer[]; spent integer;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT public.has_feature(p_user,'lesson_review_plan') THEN RAISE EXCEPTION 'premium required'; END IF;
 SELECT * INTO p FROM public.weekly_plans WHERE id=p_id AND user_id=p_user FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'weekly unavailable'; END IF;
 IF p.revision IS DISTINCT FROM p_revision OR (now() AT TIME ZONE p.time_zone)::date>p.starts_on+6 THEN RAISE EXCEPTION 'weekly conflict'; END IF;
 snapshot:=public.learning_path_context(p_user);
 IF p_token IS DISTINCT FROM snapshot->>'token' THEN RAISE EXCEPTION 'weekly conflict'; END IF;
 IF jsonb_typeof(p_days)<>'array' OR jsonb_array_length(p_days)<>7 THEN RAISE EXCEPTION 'weekly invalid days'; END IF;
 FOR d IN SELECT value FROM jsonb_array_elements(p_days) LOOP
  n:=(d->>'index')::integer;
  IF n IS NULL OR n NOT BETWEEN 0 AND 6 OR n=ANY(seen) OR NOT EXISTS(SELECT 1 FROM public.weekly_plan_days WHERE plan_id=p.id AND day_index=n AND scheduled_on=(d->>'date')::date) THEN RAISE EXCEPTION 'weekly invalid day'; END IF;
  seen:=array_append(seen,n); positions:=ARRAY[]::integer[]; spent:=0;
  IF jsonb_typeof(d->'tasks')<>'array' OR jsonb_array_length(d->'tasks')>4 THEN RAISE EXCEPTION 'weekly invalid tasks'; END IF;
  -- Past sessions are immutable, including unfinished tasks.
  IF (d->>'date')::date<(now() AT TIME ZONE p.time_zone)::date THEN CONTINUE; END IF;
  FOR t IN SELECT value FROM jsonb_array_elements(d->'tasks') LOOP
   pos:=(t->>'position')::integer;
   IF pos IS NULL OR pos NOT BETWEEN 0 AND 3 OR pos=ANY(positions) OR (t->>'minutes')::integer<>5 OR t->>'kind' NOT IN('lesson','practice') THEN RAISE EXCEPTION 'weekly invalid task'; END IF;
   positions:=array_append(positions,pos); spent:=spent+5;
   IF EXISTS(SELECT 1 FROM public.weekly_plan_tasks WHERE plan_id=p.id AND day_index=n AND position=pos AND completed_at IS NOT NULL) THEN
    IF NOT EXISTS(SELECT 1 FROM public.weekly_plan_tasks WHERE plan_id=p.id AND day_index=n AND position=pos AND lesson_id=(t->>'lessonId')::uuid) THEN RAISE EXCEPTION 'weekly completed task immutable'; END IF;
    CONTINUE;
   END IF;
   SELECT value INTO candidate FROM jsonb_array_elements(snapshot->'context'->'lessons') WHERE value->>'id'=t->>'lessonId';
   IF candidate IS NULL OR NOT public.can_access_lesson(p_user,(t->>'lessonId')::uuid) THEN RAISE EXCEPTION 'weekly unavailable lesson'; END IF;
   INSERT INTO public.weekly_plan_tasks(plan_id,day_index,position,lesson_id,title,kind,ready)
   VALUES(p.id,n,pos,(t->>'lessonId')::uuid,candidate->>'title',t->>'kind',coalesce((t->>'ready')::boolean,false))
   ON CONFLICT(plan_id,day_index,position) DO UPDATE SET lesson_id=excluded.lesson_id,title=excluded.title,kind=excluded.kind,ready=excluded.ready,
   created_at=CASE WHEN public.weekly_plan_tasks.lesson_id=excluded.lesson_id THEN public.weekly_plan_tasks.created_at ELSE now() END;
  END LOOP;
  -- Reducing the budget never removes completed work; only remaining tasks are limited.
  IF spent>greatest(p.minutes,(SELECT coalesce(sum(minutes),0) FROM public.weekly_plan_tasks WHERE plan_id=p.id AND day_index=n AND completed_at IS NOT NULL)) THEN RAISE EXCEPTION 'weekly invalid budget'; END IF;
  IF EXISTS(SELECT 1 FROM public.weekly_plan_tasks WHERE plan_id=p.id AND day_index=n AND completed_at IS NOT NULL AND NOT(position=ANY(positions))) THEN RAISE EXCEPTION 'weekly completed task immutable'; END IF;
  DELETE FROM public.weekly_plan_tasks WHERE plan_id=p.id AND day_index=n AND completed_at IS NULL AND NOT(position=ANY(positions));
 END LOOP;
 UPDATE public.weekly_plans SET revision=revision+1,context_token=p_token WHERE id=p.id;
 RETURN public.weekly_plan_view(p.id);
END $$;
CREATE FUNCTION public.weekly_plan_move(p_user uuid,p_id uuid,p_day integer,p_date date,p_revision integer) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE p public.weekly_plans; original date; target integer; today date;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT public.has_feature(p_user,'lesson_review_plan') THEN RAISE EXCEPTION 'premium required'; END IF;
 SELECT * INTO p FROM public.weekly_plans WHERE id=p_id AND user_id=p_user FOR UPDATE;
 IF p.id IS NULL THEN RAISE EXCEPTION 'weekly unavailable'; END IF;
 IF p.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'weekly conflict'; END IF;
 today:=(now() AT TIME ZONE p.time_zone)::date;
 IF p_day IS NULL OR p_day NOT BETWEEN 0 AND 6 OR p_date IS NULL OR p_date<today OR p_date<p.starts_on OR p_date>p.starts_on+6 THEN RAISE EXCEPTION 'weekly invalid move'; END IF;
 SELECT scheduled_on INTO original FROM public.weekly_plan_days WHERE plan_id=p.id AND day_index=p_day;
 IF original<today OR EXISTS(SELECT 1 FROM public.weekly_plan_tasks WHERE plan_id=p.id AND day_index=p_day AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'weekly invalid completed move'; END IF;
 SELECT day_index INTO target FROM public.weekly_plan_days WHERE plan_id=p.id AND scheduled_on=p_date;
 IF EXISTS(SELECT 1 FROM public.weekly_plan_tasks WHERE plan_id=p.id AND day_index=target AND completed_at IS NOT NULL) THEN RAISE EXCEPTION 'weekly invalid completed move'; END IF;
 UPDATE public.weekly_plan_days SET scheduled_on=CASE WHEN day_index=p_day THEN p_date ELSE original END WHERE plan_id=p.id AND day_index IN(p_day,target);
 UPDATE public.weekly_plans SET revision=revision+1 WHERE id=p.id;
END $$;
-- Completion is server evidence. No client-provided checkbox can complete a task.
CREATE FUNCTION voklumi_private.weekly_lesson_completed() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE task record;
BEGIN
 IF NEW.status<>'completed' OR (TG_OP='UPDATE' AND OLD.status='completed') THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.users WHERE id=NEW.user_id FOR UPDATE;
 SELECT t.plan_id,t.day_index,t.position INTO task FROM public.weekly_plan_tasks t JOIN public.weekly_plans p ON p.id=t.plan_id JOIN public.weekly_plan_days d ON d.plan_id=t.plan_id AND d.day_index=t.day_index
 WHERE NEW.score>=60 AND p.user_id=NEW.user_id AND t.lesson_id=NEW.lesson_id AND t.completed_at IS NULL AND t.created_at<=NEW.completed_at
 AND (NEW.completed_at AT TIME ZONE p.time_zone)::date BETWEEN p.starts_on AND p.starts_on+6
 ORDER BY d.scheduled_on,t.position LIMIT 1 FOR UPDATE OF t;
 IF FOUND THEN UPDATE public.weekly_plan_tasks SET completed_at=NEW.completed_at,attempt_id=NEW.id WHERE plan_id=task.plan_id AND day_index=task.day_index AND position=task.position; END IF;
 UPDATE public.weekly_plans SET context_token=NULL,revision=revision+1 WHERE user_id=NEW.user_id AND (NEW.completed_at AT TIME ZONE time_zone)::date BETWEEN starts_on AND starts_on+6;
 RETURN NEW;
END $$;
CREATE TRIGGER weekly_lesson_completed AFTER INSERT OR UPDATE OF status ON public.lesson_attempts FOR EACH ROW EXECUTE FUNCTION voklumi_private.weekly_lesson_completed();
REVOKE ALL ON FUNCTION public.weekly_plan_view(uuid),public.weekly_plan_snapshot(uuid,text,integer),public.weekly_plan_store(uuid,uuid,integer,text,jsonb),public.weekly_plan_move(uuid,uuid,integer,date,integer),voklumi_private.weekly_lesson_completed() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_plan_view(uuid),public.weekly_plan_snapshot(uuid,text,integer),public.weekly_plan_store(uuid,uuid,integer,text,jsonb),public.weekly_plan_move(uuid,uuid,integer,date,integer) TO service_role;
CREATE FUNCTION public.weekly_plan_database_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','weekly-v1','ready',
  (SELECT count(*)=3 AND bool_and(relrowsecurity) FROM pg_catalog.pg_class WHERE oid IN ('public.weekly_plans'::regclass,'public.weekly_plan_days'::regclass,'public.weekly_plan_tasks'::regclass))
  AND NOT EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated']) AS r(role_name) CROSS JOIN unnest(ARRAY['public.weekly_plans','public.weekly_plan_days','public.weekly_plan_tasks']) AS t(table_name) WHERE has_table_privilege(r.role_name,t.table_name,'SELECT,INSERT,UPDATE,DELETE'))
  AND NOT has_function_privilege('anon','public.weekly_plan_snapshot(uuid,text,integer)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.weekly_plan_store(uuid,uuid,integer,text,jsonb)','EXECUTE')
  AND NOT has_function_privilege('authenticated','public.weekly_plan_move(uuid,uuid,integer,date,integer)','EXECUTE'))
$$;
REVOKE ALL ON FUNCTION public.weekly_plan_database_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.weekly_plan_database_status() TO service_role;
COMMIT;
