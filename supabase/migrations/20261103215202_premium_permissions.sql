BEGIN;
-- Existing Stars subscriptions and historical plus/pro rows remain intact.
ALTER TABLE public.subscriptions ADD COLUMN grant_reason text
  CHECK (grant_reason IS NULL OR (star_order_id IS NULL AND plan='premium' AND length(trim(grant_reason)) BETWEEN 3 AND 200));
REVOKE ALL ON public.subscriptions FROM PUBLIC,anon,authenticated;
GRANT SELECT(id,user_id,plan,status,starts_at,ends_at) ON public.subscriptions TO authenticated;

CREATE TABLE public.subscription_features (
 key text PRIMARY KEY CHECK(key IN ('premium_courses','extra_exercises','advanced_statistics','lesson_review_plan')),
 minimum_plan text NOT NULL CHECK(minimum_plan IN ('free','premium')),
 enabled boolean NOT NULL DEFAULT true
);
ALTER TABLE public.subscription_features ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.subscription_features FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.subscription_features TO service_role;
INSERT INTO public.subscription_features(key,minimum_plan) VALUES
 ('premium_courses','premium'),
 ('extra_exercises','premium'),('advanced_statistics','premium'),('lesson_review_plan','premium');

CREATE OR REPLACE FUNCTION public.has_premium(p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.subscriptions s LEFT JOIN public.star_orders o ON o.id=s.star_order_id
 WHERE s.user_id=p_user AND s.plan='premium' AND s.status='active' AND s.starts_at<=now() AND s.ends_at>now()
 AND ((s.star_order_id IS NOT NULL AND o.user_id=s.user_id AND o.state IN ('paid','refund_pending'))
 OR (s.star_order_id IS NULL AND s.grant_reason IS NOT NULL)))
$$;
CREATE FUNCTION public.has_feature(p_user uuid,p_feature text) RETURNS boolean
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce((SELECT enabled AND (minimum_plan='free' OR public.has_premium(p_user))
 FROM public.subscription_features WHERE key=p_feature),false)
$$;
-- Only the current Supabase identity, never a caller-supplied user ID, is usable in RLS.
CREATE SCHEMA IF NOT EXISTS voklumi_private;
REVOKE ALL ON SCHEMA voklumi_private FROM PUBLIC;
GRANT USAGE ON SCHEMA voklumi_private TO anon,authenticated,service_role;
CREATE FUNCTION voklumi_private.current_user_has_feature(p_feature text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT public.has_feature(auth.uid(),p_feature)
$$;

-- Trusted internal activation; no browser API exposes this operation. A request UUID is its idempotency key.
CREATE FUNCTION public.grant_premium_access(p_user uuid,p_request uuid,p_days integer,p_reason text) RETURNS uuid
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE existing public.subscriptions; anchor timestamptz;
BEGIN
 IF p_user IS NULL OR p_request IS NULL OR p_days IS NULL OR p_days NOT BETWEEN 1 AND 366
 OR p_reason IS NULL OR length(trim(p_reason)) NOT BETWEEN 3 AND 200 THEN RAISE EXCEPTION 'invalid premium grant'; END IF;
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
 SELECT * INTO existing FROM public.subscriptions WHERE id=p_request;
 IF FOUND THEN
  IF existing.user_id<>p_user OR existing.star_order_id IS NOT NULL OR existing.grant_reason IS DISTINCT FROM trim(p_reason)
   OR existing.ends_at-existing.starts_at<>p_days*interval '24 hours' THEN RAISE EXCEPTION 'premium grant conflict'; END IF;
  RETURN existing.id;
 END IF;
 SELECT greatest(now(),coalesce(max(s.ends_at),now())) INTO anchor
 FROM public.subscriptions s LEFT JOIN public.star_orders o ON o.id=s.star_order_id
 WHERE s.user_id=p_user AND s.plan='premium' AND s.status='active' AND s.ends_at>now()
 AND ((s.star_order_id IS NULL AND s.grant_reason IS NOT NULL) OR (o.user_id=s.user_id AND o.state IN ('paid','refund_pending')));
 INSERT INTO public.subscriptions(id,user_id,plan,status,starts_at,ends_at,grant_reason)
 VALUES(p_request,p_user,'premium','active',anchor,anchor+p_days*interval '24 hours',trim(p_reason));
 RETURN p_request;
END $$;

CREATE OR REPLACE FUNCTION public.premium_status(p_user uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE entitlement boolean; s record; state text; features jsonb;
BEGIN
 entitlement:=public.has_premium(p_user);
 SELECT sub.*,o.state AS order_state INTO s FROM public.subscriptions sub LEFT JOIN public.star_orders o ON o.id=sub.star_order_id
 WHERE sub.user_id=p_user AND sub.plan='premium' AND (sub.grant_reason IS NOT NULL OR o.id IS NOT NULL)
 ORDER BY CASE WHEN sub.status='active' AND sub.starts_at<=now() AND sub.ends_at>now() AND (sub.grant_reason IS NOT NULL OR o.state IN ('paid','refund_pending')) THEN 0
 WHEN sub.status='active' AND sub.starts_at>now() AND (sub.grant_reason IS NOT NULL OR o.state IN ('paid','refund_pending')) THEN 1 ELSE 2 END,
 CASE WHEN sub.starts_at>now() THEN sub.starts_at END ASC,sub.ends_at DESC,sub.id LIMIT 1;
 state:=CASE WHEN entitlement THEN CASE WHEN s.order_state='refund_pending' THEN 'refund_pending' ELSE 'active' END
 WHEN s.status='refunded' OR s.order_state='refunded' THEN 'refunded'
 WHEN s.status='cancelled' THEN 'cancelled'
 WHEN s.status='expired' OR s.ends_at<=now() THEN 'expired'
 WHEN s.starts_at>now() AND s.status='active' AND (s.grant_reason IS NOT NULL OR s.order_state IN ('paid','refund_pending')) THEN 'scheduled'
 ELSE 'free' END;
 SELECT coalesce(jsonb_object_agg(key,public.has_feature(p_user,key)),'{}') INTO features FROM public.subscription_features;
 RETURN jsonb_build_object('version','permissions-v1','plan',CASE WHEN entitlement THEN 'premium' ELSE 'free' END,
 'premium',entitlement,'status',state,'startsAt',s.starts_at,'expiresAt',CASE WHEN state='refunded' THEN NULL ELSE s.ends_at END,
 'autoRenew',false,'serverTime',now(),'features',features);
END $$;

CREATE OR REPLACE FUNCTION public.can_access_lesson(p_user uuid,p_lesson uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id
 WHERE l.id=p_lesson AND l.published AND c.published AND lang.active AND (c.access_tier='free' OR l.free_preview OR public.has_feature(p_user,'premium_courses')))
$$;

-- Preserve the existing engine and its snapshots; replace only its extra-exercise permission predicate.
DO $$
DECLARE signature text; definition text;
BEGIN
 FOREACH signature IN ARRAY ARRAY['public.start_lesson_core(uuid,uuid,uuid)','public.lesson_state(uuid,uuid)','public.learning_path_context(uuid)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  IF position('public.has_premium(p_user)' IN definition)=0 THEN RAISE EXCEPTION 'unexpected permission predicate in %',signature; END IF;
  EXECUTE replace(definition,'public.has_premium(p_user)','public.has_feature(p_user,''extra_exercises'')');
 END LOOP;
END $$;
DROP POLICY lessons_read ON public.lessons;
CREATE POLICY lessons_read ON public.lessons FOR SELECT TO anon,authenticated USING(published AND EXISTS(
 SELECT 1 FROM public.units u JOIN public.courses c ON c.id=u.course_id WHERE u.id=unit_id
 AND (c.access_tier='free' OR free_preview OR voklumi_private.current_user_has_feature('premium_courses'))));
DROP POLICY exercises_read ON public.exercises;
CREATE POLICY exercises_read ON public.exercises FOR SELECT TO anon,authenticated USING(
 (NOT premium_only OR voklumi_private.current_user_has_feature('extra_exercises')) AND EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=lesson_id));

-- Keep the existing response shape. Both premium capabilities are checked at execution time.
DO $$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.premium_features(uuid)'::regprocedure);
 IF position('IF NOT public.has_premium(p_user)' IN definition)=0 THEN RAISE EXCEPTION 'unexpected premium features body'; END IF;
 EXECUTE replace(definition,'IF NOT public.has_premium(p_user)',
 'IF NOT public.has_feature(p_user,''advanced_statistics'') OR NOT public.has_feature(p_user,''lesson_review_plan'')');
END $$;
REVOKE ALL ON FUNCTION public.has_feature(uuid,text),public.grant_premium_access(uuid,uuid,integer,text),voklumi_private.current_user_has_feature(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.has_feature(uuid,text),public.grant_premium_access(uuid,uuid,integer,text) TO service_role;
GRANT EXECUTE ON FUNCTION voklumi_private.current_user_has_feature(text) TO anon,authenticated,service_role;
CREATE FUNCTION public.premium_permissions_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','permissions-v1','ready',
 (SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid='public.subscription_features'::regclass)
 AND (SELECT count(*)=4 FROM public.subscription_features)
 AND NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role)
 WHERE pg_catalog.has_any_column_privilege(r.role,'public.subscriptions','INSERT,UPDATE')
 OR pg_catalog.has_table_privilege(r.role,'public.subscriptions','DELETE,TRUNCATE')
 OR pg_catalog.has_table_privilege(r.role,'public.subscription_features','SELECT,INSERT,UPDATE,DELETE,TRUNCATE'))
 AND NOT EXISTS(SELECT 1 FROM (VALUES('public.has_feature(uuid,text)'),('public.grant_premium_access(uuid,uuid,integer,text)'),('public.premium_status(uuid)'),('public.premium_features(uuid)')) f(signature)
 WHERE pg_catalog.has_function_privilege('anon',f.signature,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',f.signature,'EXECUTE')
 OR NOT pg_catalog.has_function_privilege('service_role',f.signature,'EXECUTE')))
$$;
REVOKE ALL ON FUNCTION public.premium_permissions_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.premium_permissions_status() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
