BEGIN;
ALTER TABLE public.ops_error_counters ADD COLUMN notified_occurrences bigint NOT NULL DEFAULT 0 CHECK(notified_occurrences>=0 AND notified_occurrences<=occurrences);
CREATE OR REPLACE FUNCTION public.privacy_ops_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('version','privacy-ops-v2','ready',
 EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid='public.ops_error_counters'::regclass AND attname='notified_occurrences' AND NOT attisdropped) AND (SELECT count(*)=3 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('privacy_deletion_requests','ops_error_counters','ops_notification_leases') AND c.relrowsecurity)
 AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('privacy_deletion_requests','ops_error_counters','ops_notification_leases') AND (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('request_account_deletion','record_ops_error','claim_ops_notification','complete_ops_notification','privacy_ops_status') AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))));
$$;
REVOKE ALL ON FUNCTION public.privacy_ops_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.privacy_ops_status() TO service_role;
COMMIT;
