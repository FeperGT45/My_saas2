BEGIN;
CREATE TABLE public.privacy_deletion_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 request_id uuid NOT NULL, status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','completed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(user_id,request_id)
);
CREATE UNIQUE INDEX privacy_one_open_request ON public.privacy_deletion_requests(user_id) WHERE status IN ('pending','processing');
CREATE INDEX privacy_requests_user_date ON public.privacy_deletion_requests(user_id,created_at DESC);
CREATE INDEX privacy_requests_created_date ON public.privacy_deletion_requests(created_at DESC);
CREATE INDEX privacy_requests_status_date ON public.privacy_deletion_requests(status,created_at DESC);
CREATE TABLE public.ops_error_counters (
 code text PRIMARY KEY CHECK(code IN ('payment_webhook','telegram_webhook','payment_invoice','lesson_api','privacy_api','admin_api')),
 occurrences bigint NOT NULL DEFAULT 1 CHECK(occurrences>0), last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.ops_notification_leases (
 key text PRIMARY KEY CHECK(length(key) BETWEEN 1 AND 80 AND key ~ '^[a-z_:]+$'),
 lease_id uuid NOT NULL, reserved_until timestamptz NOT NULL, cooldown integer NOT NULL CHECK(cooldown BETWEEN 300 AND 86400),
 delivered_at timestamptz
);
ALTER TABLE public.privacy_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_error_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ops_notification_leases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.privacy_deletion_requests,public.ops_error_counters,public.ops_notification_leases FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.privacy_deletion_requests,public.ops_error_counters,public.ops_notification_leases TO service_role;
CREATE FUNCTION public.request_account_deletion(p_user uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE r public.privacy_deletion_requests;
BEGIN
 IF p_user IS NULL OR p_request IS NULL THEN RAISE EXCEPTION 'invalid request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('privacy:'||p_user::text,0));
 SELECT * INTO r FROM public.privacy_deletion_requests WHERE user_id=p_user AND request_id=p_request;
 IF NOT FOUND THEN
  SELECT * INTO r FROM public.privacy_deletion_requests WHERE user_id=p_user AND status IN ('pending','processing');
  IF NOT FOUND THEN INSERT INTO public.privacy_deletion_requests(user_id,request_id) VALUES(p_user,p_request) RETURNING * INTO r; END IF;
 END IF;
 RETURN jsonb_build_object('id',r.id,'status',r.status,'createdAt',r.created_at);
END $$;
CREATE FUNCTION public.record_ops_error(p_code text) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
 INSERT INTO public.ops_error_counters(code) VALUES(p_code) ON CONFLICT(code) DO UPDATE SET occurrences=ops_error_counters.occurrences+1,last_seen_at=now();
$$;
CREATE FUNCTION public.claim_ops_notification(p_key text,p_cooldown integer DEFAULT 1800,p_once boolean DEFAULT false) RETURNS uuid LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE v uuid;
BEGIN
 INSERT INTO public.ops_notification_leases(key,lease_id,reserved_until,cooldown) VALUES(p_key,gen_random_uuid(),now()+interval '2 minutes',p_cooldown)
 ON CONFLICT(key) DO UPDATE SET lease_id=gen_random_uuid(),reserved_until=now()+interval '2 minutes',cooldown=p_cooldown
 WHERE ops_notification_leases.reserved_until<=now() AND (NOT p_once OR ops_notification_leases.delivered_at IS NULL)
 RETURNING lease_id INTO v;
 RETURN v;
END $$;
CREATE FUNCTION public.complete_ops_notification(p_key text,p_lease uuid,p_delivered boolean) RETURNS void LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $$
 UPDATE public.ops_notification_leases SET delivered_at=CASE WHEN p_delivered THEN now() ELSE delivered_at END,
 reserved_until=now()+CASE WHEN p_delivered THEN make_interval(secs=>cooldown) ELSE interval '2 minutes' END
 WHERE key=p_key AND lease_id=p_lease;
$$;
CREATE FUNCTION public.privacy_ops_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('version','privacy-ops-v1','ready',
 (SELECT count(*)=3 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('privacy_deletion_requests','ops_error_counters','ops_notification_leases') AND c.relrowsecurity)
 AND NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('privacy_deletion_requests','ops_error_counters','ops_notification_leases') AND (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') OR has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')))
 AND NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('request_account_deletion','record_ops_error','claim_ops_notification','complete_ops_notification','privacy_ops_status') AND (has_function_privilege('anon',p.oid,'EXECUTE') OR has_function_privilege('authenticated',p.oid,'EXECUTE'))));
$$;
REVOKE ALL ON FUNCTION public.request_account_deletion(uuid,uuid),public.record_ops_error(text),public.claim_ops_notification(text,integer,boolean),public.complete_ops_notification(text,uuid,boolean),public.privacy_ops_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(uuid,uuid),public.record_ops_error(text),public.claim_ops_notification(text,integer,boolean),public.complete_ops_notification(text,uuid,boolean),public.privacy_ops_status() TO service_role;
COMMIT;
