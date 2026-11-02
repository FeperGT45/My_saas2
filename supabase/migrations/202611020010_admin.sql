BEGIN;
-- Administrators are selected in server configuration, never in client-editable metadata.
ALTER TABLE public.courses ADD COLUMN admin_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.units ADD COLUMN admin_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.lessons ADD COLUMN admin_version integer NOT NULL DEFAULT 1;
ALTER TABLE public.exercises ADD COLUMN admin_version integer NOT NULL DEFAULT 1;
CREATE FUNCTION public.bump_admin_version() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$ BEGIN NEW.admin_version:=OLD.admin_version+1; RETURN NEW; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['courses','units','lessons','exercises'] LOOP
  EXECUTE format('CREATE TRIGGER admin_version_update BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.bump_admin_version()',t);
 END LOOP;
END $$;
CREATE TABLE public.admin_audit_events (
 id uuid PRIMARY KEY, actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
 entity text NOT NULL CHECK(entity IN ('course','unit','lesson','exercise')),entity_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN ('created','updated')),fingerprint text NOT NULL,
 result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_time_idx ON public.admin_audit_events(created_at DESC);
ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_audit_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.admin_audit_events TO service_role;
REVOKE ALL ON FUNCTION public.bump_admin_version() FROM PUBLIC,anon,authenticated;

-- Only trusted Next.js code may invoke this RPC after authenticating the administrator.
CREATE FUNCTION public.admin_save_content(p_actor uuid,p_request uuid,p_entity text,p_data jsonb,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tbl text; current_row jsonb; result jsonb; prior public.admin_audit_events; target uuid; new_version integer; fingerprint text; payload jsonb;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_actor FOR UPDATE;
 IF NOT FOUND OR p_request IS NULL THEN RAISE EXCEPTION 'admin invalid actor'; END IF;
 tbl:=CASE p_entity WHEN 'course' THEN 'courses' WHEN 'unit' THEN 'units' WHEN 'lesson' THEN 'lessons' WHEN 'exercise' THEN 'exercises' END;
 IF tbl IS NULL OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'admin invalid content'; END IF;
 target:=(p_data->>'id')::uuid;
 IF target IS NULL OR p_confirmation IS DISTINCT FROM 'SAVE:'||p_entity||':'||target::text THEN RAISE EXCEPTION 'admin confirmation required'; END IF;
 fingerprint:=md5(jsonb_build_object('entity',p_entity,'data',p_data)::text);
 SELECT * INTO prior FROM public.admin_audit_events WHERE id=p_request;
 IF FOUND THEN
  IF prior.actor_id IS DISTINCT FROM p_actor OR prior.fingerprint<>fingerprint THEN RAISE EXCEPTION 'admin request conflict'; END IF;
  RETURN prior.result;
 END IF;
 EXECUTE format('SELECT to_jsonb(t) FROM public.%I t WHERE id=$1 FOR UPDATE',tbl) INTO current_row USING target;
 IF (current_row IS NULL AND (p_data->>'version')::integer IS DISTINCT FROM 0) OR (current_row IS NOT NULL AND (p_data->>'version')::integer IS DISTINCT FROM (current_row->>'admin_version')::integer) THEN RAISE EXCEPTION 'admin version conflict'; END IF;
 IF p_entity='course' THEN
  IF (p_data->>'published')::boolean AND NOT EXISTS(SELECT 1 FROM public.units u JOIN public.lessons l ON l.unit_id=u.id WHERE u.course_id=target AND l.published) THEN RAISE EXCEPTION 'admin empty publication'; END IF;
  IF current_row IS NULL THEN
   INSERT INTO public.courses(id,language_id,slug,title,level,published,access_tier) VALUES(target,(p_data->>'language_id')::uuid,p_data->>'slug',p_data->>'title',p_data->>'level',(p_data->>'published')::boolean,p_data->>'access_tier') RETURNING admin_version INTO new_version;
  ELSE
   UPDATE public.courses SET language_id=(p_data->>'language_id')::uuid,slug=p_data->>'slug',title=p_data->>'title',level=p_data->>'level',published=(p_data->>'published')::boolean,access_tier=p_data->>'access_tier' WHERE id=target RETURNING admin_version INTO new_version;
  END IF;
 ELSIF p_entity='unit' THEN
  IF current_row IS NOT NULL AND current_row->>'course_id' IS DISTINCT FROM p_data->>'course_id' THEN RAISE EXCEPTION 'admin invalid parent'; END IF;
  IF current_row IS NULL THEN
   INSERT INTO public.units(id,course_id,title,position) VALUES(target,(p_data->>'course_id')::uuid,p_data->>'title',(p_data->>'position')::integer) RETURNING admin_version INTO new_version;
  ELSE
   UPDATE public.units SET title=p_data->>'title',position=(p_data->>'position')::integer WHERE id=target RETURNING admin_version INTO new_version;
  END IF;
 ELSIF p_entity='lesson' THEN
  IF current_row IS NOT NULL AND current_row->>'unit_id' IS DISTINCT FROM p_data->>'unit_id' THEN RAISE EXCEPTION 'admin invalid parent'; END IF;
  IF (p_data->>'published')::boolean AND NOT EXISTS(SELECT 1 FROM public.exercises WHERE lesson_id=target AND NOT premium_only) THEN RAISE EXCEPTION 'admin empty publication'; END IF;
  IF current_row IS NULL THEN
   INSERT INTO public.lessons(id,unit_id,title,position,xp_reward,published,free_preview) VALUES(target,(p_data->>'unit_id')::uuid,p_data->>'title',(p_data->>'position')::integer,(p_data->>'xp_reward')::integer,(p_data->>'published')::boolean,(p_data->>'free_preview')::boolean) RETURNING admin_version INTO new_version;
  ELSE
   UPDATE public.lessons SET title=p_data->>'title',position=(p_data->>'position')::integer,xp_reward=(p_data->>'xp_reward')::integer,published=(p_data->>'published')::boolean,free_preview=(p_data->>'free_preview')::boolean WHERE id=target RETURNING admin_version INTO new_version;
  END IF;
 ELSE
  IF current_row IS NOT NULL AND current_row->>'lesson_id' IS DISTINCT FROM p_data->>'lesson_id' THEN RAISE EXCEPTION 'admin invalid parent'; END IF;
  PERFORM 1 FROM public.lessons WHERE id=(p_data->>'lesson_id')::uuid FOR UPDATE;
  payload:=public.lesson_public_payload(p_data->>'kind',p_data->'public_payload');
  IF NOT coalesce(public.lesson_key_valid(p_data->>'kind',payload,p_data->'answer_key'),false) THEN RAISE EXCEPTION 'admin invalid exercise'; END IF;
  -- A published lesson must keep at least one ordinary question for Free attempts.
  IF (p_data->>'premium_only')::boolean AND EXISTS(SELECT 1 FROM public.lessons WHERE id=(p_data->>'lesson_id')::uuid AND published) AND NOT EXISTS(SELECT 1 FROM public.exercises WHERE lesson_id=(p_data->>'lesson_id')::uuid AND id<>target AND NOT premium_only) THEN RAISE EXCEPTION 'admin empty publication'; END IF;
  IF current_row IS NULL THEN
   INSERT INTO public.exercises(id,lesson_id,position,kind,prompt,explanation,premium_only,public_payload,answer_key) VALUES(target,(p_data->>'lesson_id')::uuid,(p_data->>'position')::integer,p_data->>'kind',p_data->>'prompt',p_data->>'explanation',(p_data->>'premium_only')::boolean,payload,p_data->'answer_key') RETURNING admin_version INTO new_version;
  ELSE
   UPDATE public.exercises SET position=(p_data->>'position')::integer,kind=p_data->>'kind',prompt=p_data->>'prompt',explanation=p_data->>'explanation',premium_only=(p_data->>'premium_only')::boolean,public_payload=payload,answer_key=p_data->'answer_key' WHERE id=target RETURNING admin_version INTO new_version;
   DELETE FROM public.exercise_options WHERE exercise_id=target;
  END IF;
 END IF;
 result:=jsonb_build_object('id',target,'version',new_version,'entity',p_entity);
 INSERT INTO public.admin_audit_events(id,actor_id,entity,entity_id,action,fingerprint,result) VALUES(p_request,p_actor,p_entity,target,CASE WHEN current_row IS NULL THEN 'created' ELSE 'updated' END,fingerprint,result);
 RETURN result;
END $$;

CREATE FUNCTION public.admin_read(p_view text,p_parent uuid DEFAULT NULL,p_search text DEFAULT '',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 IF p_offset IS NULL OR p_offset<0 OR p_offset>1000000 OR p_search IS NULL OR length(p_search)>80 THEN RAISE EXCEPTION 'admin invalid query'; END IF;
 IF p_view IN ('units','lessons','exercises') AND p_parent IS NULL THEN RAISE EXCEPTION 'admin invalid parent'; END IF;
 IF p_view='overview' THEN
  SELECT jsonb_build_object('items','[]'::jsonb,'total',0,'summary',jsonb_build_object(
   'users',(SELECT count(*) FROM public.users),
   'activeUsers7d',(SELECT count(DISTINCT user_id) FROM public.lesson_attempts WHERE started_at>=now()-interval '7 days' OR completed_at>=now()-interval '7 days'),
   'started7d',(SELECT count(*) FROM public.lesson_attempts WHERE started_at>=now()-interval '7 days'),
   'completed7d',(SELECT count(*) FROM public.lesson_attempts WHERE completed_at>=now()-interval '7 days'),
   'completionRate',(SELECT coalesce(round(100.0*count(*) FILTER(WHERE status='completed')/nullif(count(*),0)),0) FROM public.lesson_attempts WHERE started_at>=now()-interval '7 days'),
   'averageScore7d',(SELECT coalesce(round(avg(score)),0) FROM public.lesson_attempts WHERE completed_at>=now()-interval '7 days'),
   'courses',(SELECT count(*) FROM public.courses),
   'publishedLessons',(SELECT count(*) FROM public.lessons WHERE published))) INTO result;
 ELSIF p_view='users' THEN
  WITH filtered AS(SELECT u.id,u.display_name,u.created_at,(SELECT coalesce(sum(amount),0) FROM public.xp_events WHERE user_id=u.id) AS xp,(SELECT count(*) FROM public.lesson_attempts WHERE user_id=u.id AND status='completed') AS completions,(SELECT max(greatest(started_at,completed_at)) FROM public.lesson_attempts WHERE user_id=u.id) AS last_active_at FROM public.users u WHERE strpos(lower(u.display_name),lower(p_search))>0)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_view='courses' THEN
  WITH filtered AS(SELECT id,language_id,slug,title,level,published,access_tier,admin_version FROM public.courses WHERE strpos(lower(title),lower(p_search))>0)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY title,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_view='units' THEN
  WITH filtered AS(SELECT id,course_id,title,position,admin_version FROM public.units WHERE course_id=p_parent)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY position,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_view='lessons' THEN
  WITH filtered AS(SELECT l.id,l.unit_id,l.title,l.position,l.xp_reward,l.published,l.free_preview,l.admin_version,(SELECT count(*) FROM public.lesson_attempts WHERE lesson_id=l.id) AS attempts,(SELECT count(*) FROM public.lesson_attempts WHERE lesson_id=l.id AND status='completed') AS completions,(SELECT round(avg(score)) FROM public.lesson_attempts WHERE lesson_id=l.id AND status='completed') AS average_score FROM public.lessons l WHERE unit_id=p_parent)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY position,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_view='exercises' THEN
  WITH filtered AS(SELECT e.id,e.lesson_id,e.position,e.kind,e.prompt,e.explanation,e.premium_only,e.admin_version,
   CASE WHEN e.kind='single_choice' AND e.public_payload='{}' THEN jsonb_build_object('options',(SELECT jsonb_agg(jsonb_build_object('id',o.id::text,'label',o.label) ORDER BY o.position) FROM public.exercise_options o WHERE o.exercise_id=e.id)) ELSE e.public_payload END AS public_payload,
   CASE WHEN e.kind='single_choice' AND e.public_payload='{}' THEN jsonb_build_object('value',(SELECT o.id::text FROM public.exercise_options o WHERE o.exercise_id=e.id AND o.is_correct)) ELSE e.answer_key END AS answer_key
   FROM public.exercises e WHERE lesson_id=p_parent)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY position,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_view='languages' THEN
  WITH filtered AS(SELECT id,name,code,active FROM public.languages)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY code,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_view='activity' THEN
  WITH filtered AS(SELECT a.id,u.display_name,l.title AS lesson_title,a.status,a.score,a.started_at,a.completed_at FROM public.lesson_attempts a JOIN public.users u ON u.id=a.user_id JOIN public.lessons l ON l.id=a.lesson_id WHERE strpos(lower(u.display_name),lower(p_search))>0)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY started_at DESC,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_view='subscriptions' THEN
  WITH filtered AS(SELECT s.id,u.display_name,s.plan,CASE WHEN s.status='active' AND s.ends_at<=now() THEN 'expired' ELSE s.status END AS status,s.starts_at,s.ends_at,o.state AS payment_state FROM public.subscriptions s JOIN public.users u ON u.id=s.user_id LEFT JOIN public.star_orders o ON o.id=s.star_order_id WHERE strpos(lower(u.display_name),lower(p_search))>0)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY ends_at DESC,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSIF p_view='audit' THEN
  WITH filtered AS(SELECT a.id,a.entity,a.entity_id,a.action,(a.result->>'version')::integer AS version,u.display_name AS actor_name,a.created_at FROM public.admin_audit_events a LEFT JOIN public.users u ON u.id=a.actor_id)
  SELECT jsonb_build_object('items',coalesce((SELECT jsonb_agg(to_jsonb(r)) FROM (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT 25 OFFSET p_offset) r),'[]'),'total',(SELECT count(*) FROM filtered)) INTO result;
 ELSE RAISE EXCEPTION 'admin invalid query'; END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.admin_save_content(uuid,uuid,text,jsonb,text),public.admin_read(text,uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_content(uuid,uuid,text,jsonb,text),public.admin_read(text,uuid,text,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.voklumi_database_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item text; rel oid; ok boolean:=true; writes_denied boolean; reads_denied boolean; enabled boolean; cols boolean; rpc_ok boolean; checks jsonb:='[]'; func record;
BEGIN
 FOREACH item IN ARRAY ARRAY['users','languages','courses','units','lessons','exercises','exercise_options','user_progress','lesson_attempts','xp_events','achievements','user_achievements','daily_streaks','referrals','subscriptions','telegram_sessions','lesson_attempt_items','exercise_submissions','coin_events','star_orders','star_events','admin_audit_events'] LOOP
  rel:=pg_catalog.to_regclass('public.'||item);
  enabled:=false;writes_denied:=false;reads_denied:=true;
  IF rel IS NOT NULL THEN
   SELECT relrowsecurity INTO enabled FROM pg_catalog.pg_class WHERE oid=rel;
   SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_any_column_privilege(r.role,rel,'INSERT') OR pg_catalog.has_any_column_privilege(r.role,rel,'UPDATE') OR pg_catalog.has_table_privilege(r.role,rel,'DELETE,TRUNCATE')) INTO writes_denied;
   IF item IN ('telegram_sessions','lesson_attempt_items','exercise_submissions','referrals','star_orders','star_events','admin_audit_events') THEN
    SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_any_column_privilege(r.role,rel,'SELECT')) INTO reads_denied;
   END IF;
  END IF;
  ok:=ok AND rel IS NOT NULL AND enabled AND writes_denied AND reads_denied;
  checks:=checks||jsonb_build_array(jsonb_build_object('name',item,'exists',rel IS NOT NULL,'rls',enabled,'clientWritesDenied',writes_denied,'privateReadsDenied',reads_denied));
 END LOOP;
 SELECT NOT EXISTS(SELECT 1 FROM (VALUES('exercises','answer_key'),('exercises','explanation'),('exercise_options','is_correct'),('users','telegram_id'),('users','telegram_username'),('users','referral_code'),('coin_events','attempt_id'),('subscriptions','provider_reference')) c(tbl,col) CROSS JOIN (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_column_privilege(r.role,'public.'||c.tbl,c.col,'SELECT')) INTO cols;
 rpc_ok:=true;
 FOR func IN SELECT signature FROM (VALUES('public.start_lesson(uuid,uuid,uuid)'),('public.lesson_state(uuid,uuid)'),('public.submit_lesson_answer(uuid,uuid,integer,jsonb)'),('public.award_completed_lesson(uuid)'),('public.create_telegram_session(uuid,bigint,text,text,text,text,text)'),('public.game_summary(uuid)'),('public.set_game_timezone(uuid,text)'),('public.import_english_curriculum(jsonb)'),('public.social_summary(uuid,text,integer)'),('public.set_social_privacy(uuid,boolean,text)'),('public.create_social_telegram_session(uuid,bigint,text,text,text,text,text,text)'),('public.create_star_order(uuid,uuid,integer)'),('public.check_star_checkout(text,bigint,text,integer,text)'),('public.apply_star_event(text,bigint,text,integer,text,boolean)'),('public.prepare_star_refund(uuid)'),('public.premium_status(uuid)'),('public.premium_features(uuid)'),('public.admin_read(text,uuid,text,integer)'),('public.admin_save_content(uuid,uuid,text,jsonb,text)'),('public.voklumi_database_status()')) f(signature) LOOP
  rel:=pg_catalog.to_regprocedure(func.signature);
  IF rel IS NULL THEN rpc_ok:=false;
  ELSIF NOT pg_catalog.has_function_privilege('service_role',rel,'EXECUTE') OR pg_catalog.has_function_privilege('anon',rel,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',rel,'EXECUTE') THEN rpc_ok:=false; END IF;
 END LOOP;
 RETURN jsonb_build_object('schemaVersion','202611020010','ready',ok AND cols AND rpc_ok,'tables',checks,'protectedColumns',cols,'rpcPermissions',rpc_ok);
END $$;



NOTIFY pgrst,'reload schema';
COMMIT;
