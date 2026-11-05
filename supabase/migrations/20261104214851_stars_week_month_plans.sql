BEGIN;
-- Old invoices and entitlements remain 30-day passes at their original price.
ALTER TABLE public.star_orders ADD COLUMN duration_days smallint NOT NULL DEFAULT 30 CHECK(duration_days IN(7,30));
CREATE FUNCTION public.create_star_plan_order(p_user uuid,p_request uuid,p_plan text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE tg bigint;o public.star_orders;days smallint;price integer;
BEGIN
 IF p_plan='week' THEN days:=7;price:=49;ELSIF p_plan='month' THEN days:=30;price:=149;ELSE RAISE EXCEPTION 'invalid premium plan';END IF;
 IF p_request IS NULL THEN RAISE EXCEPTION 'request required';END IF;
 SELECT telegram_id INTO tg FROM public.users WHERE id=p_user FOR UPDATE;
 IF tg IS NULL THEN RAISE EXCEPTION 'Telegram account required';END IF;
 UPDATE public.star_orders SET state='expired' WHERE user_id=p_user AND state IN('pending','approved') AND expires_at<=now();
 SELECT * INTO o FROM public.star_orders WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN
  IF o.duration_days<>days OR o.amount<>price THEN RAISE EXCEPTION 'request plan mismatch';END IF;
  RETURN jsonb_build_object('id',o.id,'payload',o.payload,'amount',o.amount,'days',o.duration_days,'state',o.state);
 END IF;
 IF public.has_premium(p_user) THEN RAISE EXCEPTION 'premium already active';END IF;
 SELECT * INTO o FROM public.star_orders WHERE user_id=p_user AND state IN('pending','approved');
 IF FOUND AND (o.duration_days<>days OR o.amount<>price) THEN
  IF o.state='approved' THEN RAISE EXCEPTION 'checkout already approved';END IF;
  UPDATE public.star_orders SET state='expired' WHERE id=o.id;
  o:=NULL;
 END IF;
 IF o.id IS NULL THEN
  INSERT INTO public.star_orders(user_id,telegram_id,request_id,amount,duration_days) VALUES(p_user,tg,p_request,price,days) RETURNING * INTO o;
 END IF;
 RETURN jsonb_build_object('id',o.id,'payload',o.payload,'amount',o.amount,'days',o.duration_days,'state',o.state);
END $$;
REVOKE ALL ON FUNCTION public.create_star_plan_order(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_star_plan_order(uuid,uuid,text) TO service_role;

-- Keep the existing receipt validation, locks, refunds and idempotency intact.
-- Fail migration on a different baseline rather than silently leaving 30-day grants.
DO $$
DECLARE original text;patched text;
BEGIN
 original:=pg_get_functiondef('public.apply_star_event(text,bigint,text,integer,text,boolean)'::regprocedure);
 patched:=replace(original,'starts+interval ''720 hours''','starts+make_interval(hours=>24*o.duration_days)');
 IF patched=original THEN RAISE EXCEPTION 'unexpected payment function baseline';END IF;
 EXECUTE patched;
 original:=pg_get_functiondef('public.reflow_star_access(uuid)'::regprocedure);
 patched:=replace(original,'FOR item IN SELECT s.id FROM','FOR item IN SELECT s.id,o.duration_days FROM');
 patched:=replace(patched,'anchor+interval ''720 hours''','anchor+make_interval(hours=>24*item.duration_days)');
 IF patched=original OR position('720 hours' IN patched)>0 OR position('SELECT s.id,o.duration_days' IN patched)=0 THEN RAISE EXCEPTION 'unexpected reflow function baseline';END IF;
 EXECUTE patched;
END $$;

CREATE OR REPLACE FUNCTION public.premium_expansion_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','premium-expansion-v1','starPlans','week-month-v1','ready',
 (SELECT count(*)=3 AND bool_and(relrowsecurity) FROM pg_class WHERE oid IN('public.appearance_settings'::regclass,'public.extended_attempts'::regclass,'public.extended_answers'::regclass))
 AND NOT has_function_privilege('authenticated','public.extended_answer(uuid,uuid,uuid,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.appearance_save(uuid,jsonb,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.create_star_plan_order(uuid,uuid,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.create_star_plan_order(uuid,uuid,text)','EXECUTE'))
$$;
COMMIT;
