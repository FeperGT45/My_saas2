BEGIN;
ALTER TABLE public.courses ADD COLUMN access_tier text NOT NULL DEFAULT 'free' CHECK(access_tier IN ('free','premium'));
ALTER TABLE public.lessons ADD COLUMN free_preview boolean NOT NULL DEFAULT false;
ALTER TABLE public.exercises ADD COLUMN premium_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.lesson_attempt_items ADD COLUMN premium_only boolean NOT NULL DEFAULT false;
ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_plan_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK(plan IN ('plus','pro','premium'));
ALTER TABLE public.subscriptions DROP CONSTRAINT subscriptions_status_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_status_check CHECK(status IN ('active','cancelled','expired','refunded'));
DROP INDEX public.subscriptions_one_active_idx;
-- Distinct confirmed charges retain independent entitlement windows.
CREATE TABLE public.star_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id),request_id uuid NOT NULL,
 telegram_id bigint NOT NULL CHECK(telegram_id>0), amount integer NOT NULL CHECK(amount BETWEEN 1 AND 10000),currency text NOT NULL DEFAULT 'XTR' CHECK(currency='XTR'),
 payload text GENERATED ALWAYS AS ('voklumi30:'||id::text) STORED UNIQUE,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','paid','refunded','refund_pending','expired')),
 checkout_id text UNIQUE,charge_id text UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '30 minutes',paid_at timestamptz,refunded_at timestamptz,UNIQUE(user_id,request_id)
);
CREATE UNIQUE INDEX star_one_open_order ON public.star_orders(user_id) WHERE state IN ('pending','approved');
CREATE TABLE public.star_events(event_key text PRIMARY KEY,order_id uuid NOT NULL REFERENCES public.star_orders(id),created_at timestamptz NOT NULL DEFAULT now());
ALTER TABLE public.subscriptions ADD COLUMN star_order_id uuid UNIQUE REFERENCES public.star_orders(id);
ALTER TABLE public.star_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.star_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.star_orders,public.star_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.star_orders,public.star_events TO service_role;
CREATE FUNCTION public.has_premium(p_user uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.subscriptions s JOIN public.star_orders o ON o.id=s.star_order_id WHERE s.user_id=p_user AND s.plan='premium' AND s.status='active' AND s.starts_at<=now() AND s.ends_at>now() AND o.state IN ('paid','refund_pending'))
$$;
CREATE FUNCTION public.current_user_has_premium() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$ SELECT public.has_premium(auth.uid()) $$;
CREATE FUNCTION public.can_access_lesson(p_user uuid,p_lesson uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE l.id=p_lesson AND l.published AND c.published AND lang.active AND (c.access_tier='free' OR l.free_preview OR public.has_premium(p_user)))
$$;
DROP POLICY lessons_read ON public.lessons;
CREATE POLICY lessons_read ON public.lessons FOR SELECT TO anon,authenticated USING(published AND EXISTS(SELECT 1 FROM public.units u JOIN public.courses c ON c.id=u.course_id WHERE u.id=unit_id AND (c.access_tier='free' OR free_preview OR public.current_user_has_premium())));
DROP POLICY exercises_read ON public.exercises;
CREATE POLICY exercises_read ON public.exercises FOR SELECT TO anon,authenticated USING((NOT premium_only OR public.current_user_has_premium()) AND EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=lesson_id));
CREATE FUNCTION public.create_star_order(p_user uuid,p_request uuid,p_amount integer) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tg bigint; o public.star_orders;
BEGIN
 SELECT telegram_id INTO tg FROM public.users WHERE id=p_user FOR UPDATE;
 IF tg IS NULL THEN RAISE EXCEPTION 'Telegram account required'; END IF;
 UPDATE public.star_orders SET state='expired' WHERE user_id=p_user AND state IN ('pending','approved') AND expires_at<now();
 SELECT * INTO o FROM public.star_orders WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN RETURN jsonb_build_object('id',o.id,'payload',o.payload,'amount',o.amount,'state',o.state); END IF;
 IF public.has_premium(p_user) THEN RAISE EXCEPTION 'premium already active'; END IF;
 -- Reuse an outstanding invoice, rather than creating parallel payable orders.
 SELECT * INTO o FROM public.star_orders WHERE user_id=p_user AND state IN ('pending','approved');
 IF NOT FOUND THEN INSERT INTO public.star_orders(user_id,telegram_id,request_id,amount) VALUES(p_user,tg,p_request,p_amount) RETURNING * INTO o; END IF;
 RETURN jsonb_build_object('id',o.id,'payload',o.payload,'amount',o.amount,'state',o.state);
END $$;
CREATE FUNCTION public.check_star_checkout(p_payload text,p_tg bigint,p_currency text,p_amount integer,p_query text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.star_orders;
BEGIN
 SELECT * INTO o FROM public.star_orders WHERE payload=p_payload FOR UPDATE;
 IF NOT FOUND OR p_tg IS NULL OR p_amount IS NULL OR coalesce(length(p_query),0) NOT BETWEEN 1 AND 256 OR o.telegram_id<>p_tg OR p_currency IS DISTINCT FROM 'XTR' OR o.amount<>p_amount OR o.expires_at<=now() OR o.state NOT IN ('pending','approved') OR (o.checkout_id IS NOT NULL AND o.checkout_id<>p_query) OR public.has_premium(o.user_id) THEN RETURN false; END IF;
 UPDATE public.star_orders SET state='approved',checkout_id=p_query WHERE id=o.id;RETURN true;
END $$;
CREATE FUNCTION public.reflow_star_access(p_user uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE anchor timestamptz; item record;
BEGIN
 SELECT greatest(now(),coalesce(max(s.ends_at),now())) INTO anchor FROM public.subscriptions s JOIN public.star_orders o ON o.id=s.star_order_id WHERE s.user_id=p_user AND s.status='active' AND o.state IN ('paid','refund_pending') AND s.starts_at<=now() AND s.ends_at>now();
 FOR item IN SELECT s.id FROM public.subscriptions s JOIN public.star_orders o ON o.id=s.star_order_id WHERE s.user_id=p_user AND s.status='active' AND o.state IN ('paid','refund_pending') AND s.starts_at>now() ORDER BY s.starts_at,s.id LOOP
  UPDATE public.subscriptions SET starts_at=anchor,ends_at=anchor+interval '720 hours' WHERE id=item.id;anchor:=anchor+interval '720 hours';
 END LOOP;
END $$;
CREATE FUNCTION public.apply_star_event(p_payload text,p_tg bigint,p_currency text,p_amount integer,p_charge text,p_refund boolean) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.star_orders; starts timestamptz;
BEGIN
 -- Same user lock order as lesson completion; serialize overlapping subscriptions.
 SELECT * INTO o FROM public.star_orders WHERE payload=p_payload;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown invoice'; END IF;
 PERFORM 1 FROM public.users WHERE id=o.user_id FOR UPDATE;
 SELECT * INTO o FROM public.star_orders WHERE id=o.id FOR UPDATE;
 IF p_refund IS NULL OR p_tg IS NULL OR p_amount IS NULL OR o.telegram_id<>p_tg OR p_currency IS DISTINCT FROM 'XTR' OR o.amount<>p_amount OR coalesce(length(p_charge),0) NOT BETWEEN 1 AND 256 OR (o.charge_id IS NOT NULL AND o.charge_id<>p_charge) THEN RAISE EXCEPTION 'payment mismatch'; END IF;
 IF p_refund THEN
  INSERT INTO public.star_events(event_key,order_id) VALUES('refund:'||p_charge,o.id) ON CONFLICT DO NOTHING;
  UPDATE public.star_orders SET state='refunded',charge_id=p_charge,refunded_at=coalesce(refunded_at,now()) WHERE id=o.id;
  UPDATE public.subscriptions SET status='refunded' WHERE star_order_id=o.id;
  PERFORM public.reflow_star_access(o.user_id);
  RETURN 'refunded';
 END IF;
 IF o.state='refunded' THEN RETURN 'refunded'; END IF;
 IF o.state IN ('paid','refund_pending') THEN RETURN o.state; END IF;
 IF o.checkout_id IS NULL THEN RAISE EXCEPTION 'checkout not approved'; END IF;
 INSERT INTO public.star_events(event_key,order_id) VALUES('paid:'||p_charge,o.id);
 UPDATE public.subscriptions SET status='expired' WHERE user_id=o.user_id AND plan='premium' AND status='active' AND ends_at<=now();
 SELECT greatest(now(),coalesce(max(s.ends_at),now())) INTO starts FROM public.subscriptions s JOIN public.star_orders previous_order ON previous_order.id=s.star_order_id WHERE s.user_id=o.user_id AND s.plan='premium' AND s.status='active' AND previous_order.state IN ('paid','refund_pending');
 INSERT INTO public.subscriptions(id,user_id,plan,status,starts_at,ends_at,provider_reference,star_order_id) VALUES(o.id,o.user_id,'premium','active',starts,starts+interval '720 hours',p_charge,o.id);
 UPDATE public.star_orders SET state='paid',charge_id=p_charge,paid_at=now() WHERE id=o.id;
 RETURN 'paid';
END $$;
CREATE FUNCTION public.prepare_star_refund(p_order uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.star_orders;
BEGIN
 SELECT * INTO o FROM public.star_orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.charge_id IS NULL OR o.state NOT IN ('paid','refund_pending','refunded') THEN RAISE EXCEPTION 'payment unavailable'; END IF;
 IF o.state<>'refunded' THEN UPDATE public.star_orders SET state='refund_pending' WHERE id=o.id; END IF;
 RETURN jsonb_build_object('payload',o.payload,'telegramId',o.telegram_id,'amount',o.amount,'chargeId',o.charge_id,'state',o.state);
END $$;
CREATE FUNCTION public.premium_status(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE active boolean; expiry timestamptz; last_state text; state text;
BEGIN
 active:=public.has_premium(p_user);
 SELECT o.state INTO last_state FROM public.star_orders o WHERE o.user_id=p_user AND o.state IN ('paid','refund_pending','refunded') ORDER BY o.created_at DESC LIMIT 1;
 SELECT max(s.ends_at) INTO expiry FROM public.subscriptions s JOIN public.star_orders o ON o.id=s.star_order_id WHERE s.user_id=p_user AND s.status='active' AND o.state IN ('paid','refund_pending');
 state:=CASE WHEN active THEN CASE WHEN EXISTS(SELECT 1 FROM public.star_orders WHERE user_id=p_user AND public.star_orders.state='refund_pending') THEN 'refund_pending' ELSE 'active' END WHEN last_state='refunded' THEN 'refunded' WHEN expiry IS NOT NULL AND expiry<=now() THEN 'expired' ELSE 'free' END;
 RETURN jsonb_build_object('premium',active,'status',state,'expiresAt',CASE WHEN state='refunded' THEN NULL ELSE expiry END,'autoRenew',false);
END $$;
CREATE FUNCTION public.premium_features(p_user uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE accuracy numeric; completed integer; reviews jsonb;
BEGIN
 IF NOT public.has_premium(p_user) THEN RAISE EXCEPTION 'premium required'; END IF;
 SELECT coalesce(round(100.0*count(*) FILTER(WHERE s.correct)/nullif(count(*),0)),0) INTO accuracy FROM public.exercise_submissions s JOIN public.lesson_attempts a ON a.id=s.attempt_id WHERE a.user_id=p_user;
 SELECT count(*) INTO completed FROM public.lesson_attempts WHERE user_id=p_user AND status='completed';
 SELECT coalesce(jsonb_agg(jsonb_build_object('lessonId',id,'title',title,'score',best_score,'reviewAfter',completed_at+CASE WHEN best_score<60 THEN interval '1 day' WHEN best_score<90 THEN interval '3 days' ELSE interval '7 days' END) ORDER BY best_score,completed_at),'[]') INTO reviews FROM (SELECT l.id,l.title,p.best_score,latest.completed_at FROM public.user_progress p JOIN public.lessons l ON l.id=p.lesson_id JOIN LATERAL (SELECT max(a.completed_at) AS completed_at FROM public.lesson_attempts a WHERE a.user_id=p_user AND a.lesson_id=l.id AND a.status='completed') latest ON latest.completed_at IS NOT NULL WHERE p.user_id=p_user AND public.can_access_lesson(p_user,l.id) ORDER BY p.best_score,latest.completed_at LIMIT 5) r;
 RETURN jsonb_build_object('accuracy',accuracy,'completedAttempts',completed,'reviewPlan',reviews);
END $$;
REVOKE ALL ON FUNCTION public.reflow_star_access(uuid),public.has_premium(uuid),public.can_access_lesson(uuid,uuid),public.current_user_has_premium(),public.create_star_order(uuid,uuid,integer),public.check_star_checkout(text,bigint,text,integer,text),public.apply_star_event(text,bigint,text,integer,text,boolean),public.prepare_star_refund(uuid),public.premium_status(uuid),public.premium_features(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_has_premium() TO anon,authenticated;
GRANT EXECUTE ON FUNCTION public.has_premium(uuid),public.can_access_lesson(uuid,uuid),public.create_star_order(uuid,uuid,integer),public.check_star_checkout(text,bigint,text,integer,text),public.apply_star_event(text,bigint,text,integer,text,boolean),public.prepare_star_refund(uuid),public.premium_status(uuid),public.premium_features(uuid) TO service_role;

CREATE FUNCTION public.start_lesson_core(p_user uuid,p_lesson uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.exercises; payload jsonb; key jsonb; n integer:=0;
BEGIN
 -- Serialize per-user starts and make retries of the same request idempotent.
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.lesson_attempts WHERE id=p_request) THEN
  IF NOT EXISTS(SELECT 1 FROM public.lesson_attempts WHERE id=p_request AND user_id=p_user AND lesson_id=p_lesson) THEN RAISE EXCEPTION 'attempt unavailable'; END IF;
  RETURN public.lesson_state(p_user,p_request);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE l.id=p_lesson AND l.published AND c.published AND lang.active) THEN RAISE EXCEPTION 'lesson unavailable'; END IF;
 UPDATE public.lesson_attempts SET status='abandoned' WHERE user_id=p_user AND status='started' AND started_at<now()-interval '24 hours';
 IF (SELECT count(*) FROM public.lesson_attempts WHERE user_id=p_user AND status='started')>=10 THEN RAISE EXCEPTION 'too many active attempts'; END IF;
 INSERT INTO public.lesson_attempts(id,user_id,lesson_id,xp_reward_snapshot) VALUES(p_request,p_user,p_lesson,(SELECT xp_reward FROM public.lessons WHERE id=p_lesson));
 FOR e IN SELECT * FROM public.exercises WHERE lesson_id=p_lesson AND (NOT premium_only OR public.has_premium(p_user)) ORDER BY position LIMIT 101 LOOP
  n:=n+1;
  IF n>100 THEN RAISE EXCEPTION 'lesson too large'; END IF;
  payload:=e.public_payload; key:=e.answer_key;
  IF e.kind='single_choice' AND payload='{}' THEN
   SELECT jsonb_build_object('options',jsonb_agg(jsonb_build_object('id',id::text,'label',label) ORDER BY position)),jsonb_build_object('value',max(id::text) FILTER(WHERE is_correct)) INTO payload,key FROM public.exercise_options WHERE exercise_id=e.id;
  END IF;
  payload:=public.lesson_public_payload(e.kind,payload);
  IF NOT coalesce(public.lesson_key_valid(e.kind,payload,key),false) THEN RAISE EXCEPTION 'invalid exercise key'; END IF;
  INSERT INTO public.lesson_attempt_items(attempt_id,position,exercise_id,kind,prompt,payload,answer_key,explanation,premium_only) VALUES(p_request,n,e.id,e.kind,e.prompt,payload,key,e.explanation,e.premium_only);
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'lesson is empty'; END IF;
 RETURN public.lesson_state(p_user,p_request);
END $$;

ALTER FUNCTION public.lesson_state(uuid,uuid) RENAME TO lesson_state_core;
ALTER FUNCTION public.submit_lesson_answer(uuid,uuid,integer,jsonb) RENAME TO submit_lesson_answer_core;
REVOKE ALL ON FUNCTION public.start_lesson_core(uuid,uuid,uuid),public.lesson_state_core(uuid,uuid),public.submit_lesson_answer_core(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.start_lesson(p_user uuid,p_lesson uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT public.can_access_lesson(p_user,p_lesson) THEN RAISE EXCEPTION 'premium required or lesson unavailable'; END IF;
 RETURN public.start_lesson_core(p_user,p_lesson,p_request);
END $$;
CREATE FUNCTION public.lesson_state(p_user uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE state jsonb;
BEGIN
 state:=public.lesson_state_core(p_user,p_attempt);
 IF state->>'status'='started' AND (NOT public.can_access_lesson(p_user,(state->>'lessonId')::uuid) OR (EXISTS(SELECT 1 FROM public.lesson_attempt_items WHERE attempt_id=p_attempt AND position=(state->'exercise'->>'position')::integer AND premium_only) AND NOT public.has_premium(p_user))) THEN RAISE EXCEPTION 'premium required'; END IF;
 RETURN state;
END $$;
CREATE FUNCTION public.submit_lesson_answer(p_user uuid,p_attempt uuid,p_position integer,p_answer jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM public.lesson_state(p_user,p_attempt);
 RETURN public.submit_lesson_answer_core(p_user,p_attempt,p_position,p_answer);
END $$;
REVOKE ALL ON FUNCTION public.start_lesson(uuid,uuid,uuid),public.lesson_state(uuid,uuid),public.submit_lesson_answer(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.start_lesson(uuid,uuid,uuid),public.lesson_state(uuid,uuid),public.submit_lesson_answer(uuid,uuid,integer,jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.voklumi_database_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item text; rel oid; ok boolean:=true; writes_denied boolean; reads_denied boolean; enabled boolean; cols boolean; rpc_ok boolean; checks jsonb:='[]'; func record;
BEGIN
 FOREACH item IN ARRAY ARRAY['users','languages','courses','units','lessons','exercises','exercise_options','user_progress','lesson_attempts','xp_events','achievements','user_achievements','daily_streaks','referrals','subscriptions','telegram_sessions','lesson_attempt_items','exercise_submissions','coin_events','star_orders','star_events'] LOOP
  rel:=pg_catalog.to_regclass('public.'||item);
  enabled:=false;writes_denied:=false;reads_denied:=true;
  IF rel IS NOT NULL THEN
   SELECT relrowsecurity INTO enabled FROM pg_catalog.pg_class WHERE oid=rel;
   SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_any_column_privilege(r.role,rel,'INSERT') OR pg_catalog.has_any_column_privilege(r.role,rel,'UPDATE') OR pg_catalog.has_table_privilege(r.role,rel,'DELETE,TRUNCATE')) INTO writes_denied;
   IF item IN ('telegram_sessions','lesson_attempt_items','exercise_submissions','referrals','star_orders','star_events') THEN
    SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_any_column_privilege(r.role,rel,'SELECT')) INTO reads_denied;
   END IF;
  END IF;
  ok:=ok AND rel IS NOT NULL AND enabled AND writes_denied AND reads_denied;
  checks:=checks||jsonb_build_array(jsonb_build_object('name',item,'exists',rel IS NOT NULL,'rls',enabled,'clientWritesDenied',writes_denied,'privateReadsDenied',reads_denied));
 END LOOP;
 SELECT NOT EXISTS(SELECT 1 FROM (VALUES('exercises','answer_key'),('exercises','explanation'),('exercise_options','is_correct'),('users','telegram_id'),('users','telegram_username'),('users','referral_code'),('coin_events','attempt_id'),('subscriptions','provider_reference')) c(tbl,col) CROSS JOIN (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_column_privilege(r.role,'public.'||c.tbl,c.col,'SELECT')) INTO cols;
 rpc_ok:=true;
 FOR func IN SELECT signature FROM (VALUES('public.start_lesson(uuid,uuid,uuid)'),('public.lesson_state(uuid,uuid)'),('public.submit_lesson_answer(uuid,uuid,integer,jsonb)'),('public.award_completed_lesson(uuid)'),('public.create_telegram_session(uuid,bigint,text,text,text,text,text)'),('public.game_summary(uuid)'),('public.set_game_timezone(uuid,text)'),('public.import_english_curriculum(jsonb)'),('public.social_summary(uuid,text,integer)'),('public.set_social_privacy(uuid,boolean,text)'),('public.create_social_telegram_session(uuid,bigint,text,text,text,text,text,text)'),('public.create_star_order(uuid,uuid,integer)'),('public.check_star_checkout(text,bigint,text,integer,text)'),('public.apply_star_event(text,bigint,text,integer,text,boolean)'),('public.prepare_star_refund(uuid)'),('public.premium_status(uuid)'),('public.premium_features(uuid)'),('public.voklumi_database_status()')) f(signature) LOOP
  rel:=pg_catalog.to_regprocedure(func.signature);
  IF rel IS NULL THEN rpc_ok:=false;
  ELSIF NOT pg_catalog.has_function_privilege('service_role',rel,'EXECUTE') OR pg_catalog.has_function_privilege('anon',rel,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',rel,'EXECUTE') THEN rpc_ok:=false; END IF;
 END LOOP;
 RETURN jsonb_build_object('schemaVersion','202611020009','ready',ok AND cols AND rpc_ok,'tables',checks,'protectedColumns',cols,'rpcPermissions',rpc_ok);
END $$;


NOTIFY pgrst,'reload schema';
COMMIT;
