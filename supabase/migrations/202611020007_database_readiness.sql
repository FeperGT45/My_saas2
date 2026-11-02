BEGIN;
-- Operator-only, read-only check. No account data, credentials or policy SQL returned.
CREATE FUNCTION public.voklumi_database_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item text; rel oid; ok boolean:=true; writes_denied boolean; reads_denied boolean; enabled boolean; cols boolean; rpc_ok boolean; checks jsonb:='[]'; func record;
BEGIN
 FOREACH item IN ARRAY ARRAY['users','languages','courses','units','lessons','exercises','exercise_options','user_progress','lesson_attempts','xp_events','achievements','user_achievements','daily_streaks','referrals','subscriptions','telegram_sessions','lesson_attempt_items','exercise_submissions','coin_events'] LOOP
  rel:=pg_catalog.to_regclass('public.'||item);
  enabled:=false;writes_denied:=false;reads_denied:=true;
  IF rel IS NOT NULL THEN
   SELECT relrowsecurity INTO enabled FROM pg_catalog.pg_class WHERE oid=rel;
   SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_any_column_privilege(r.role,rel,'INSERT') OR pg_catalog.has_any_column_privilege(r.role,rel,'UPDATE') OR pg_catalog.has_table_privilege(r.role,rel,'DELETE,TRUNCATE')) INTO writes_denied;
   IF item IN ('telegram_sessions','lesson_attempt_items','exercise_submissions') THEN
    SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_any_column_privilege(r.role,rel,'SELECT')) INTO reads_denied;
   END IF;
  END IF;
  ok:=ok AND rel IS NOT NULL AND enabled AND writes_denied AND reads_denied;
  checks:=checks||jsonb_build_array(jsonb_build_object('name',item,'exists',rel IS NOT NULL,'rls',enabled,'clientWritesDenied',writes_denied,'privateReadsDenied',reads_denied));
 END LOOP;
 SELECT NOT EXISTS(SELECT 1 FROM (VALUES('exercises','answer_key'),('exercises','explanation'),('exercise_options','is_correct'),('users','telegram_id'),('users','telegram_username'),('subscriptions','provider_reference')) c(tbl,col) CROSS JOIN (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_column_privilege(r.role,'public.'||c.tbl,c.col,'SELECT')) INTO cols;
 rpc_ok:=true;
 FOR func IN SELECT signature FROM (VALUES('public.start_lesson(uuid,uuid,uuid)'),('public.lesson_state(uuid,uuid)'),('public.submit_lesson_answer(uuid,uuid,integer,jsonb)'),('public.award_completed_lesson(uuid)'),('public.create_telegram_session(uuid,bigint,text,text,text,text,text)'),('public.game_summary(uuid)'),('public.set_game_timezone(uuid,text)'),('public.import_english_curriculum(jsonb)'),('public.voklumi_database_status()')) f(signature) LOOP
  rel:=pg_catalog.to_regprocedure(func.signature);
  IF rel IS NULL THEN rpc_ok:=false;
  ELSIF NOT pg_catalog.has_function_privilege('service_role',rel,'EXECUTE') OR pg_catalog.has_function_privilege('anon',rel,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',rel,'EXECUTE') THEN rpc_ok:=false; END IF;
 END LOOP;
 RETURN jsonb_build_object('schemaVersion','202611020007','ready',ok AND cols AND rpc_ok,'tables',checks,'protectedColumns',cols,'rpcPermissions',rpc_ok);
END $$;
REVOKE ALL ON FUNCTION public.voklumi_database_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.voklumi_database_status() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
