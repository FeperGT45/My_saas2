BEGIN;
ALTER TABLE public.users ADD COLUMN leaderboard_visible boolean NOT NULL DEFAULT false;
ALTER TABLE public.users ADD COLUMN public_alias text CHECK(public_alias IS NULL OR (length(trim(public_alias)) BETWEEN 2 AND 32 AND public_alias !~ '[[:cntrl:]@/:]'));
ALTER TABLE public.users ADD COLUMN referral_code text NOT NULL DEFAULT replace(gen_random_uuid()::text,'-','') UNIQUE CHECK(referral_code ~ '^[a-f0-9]{32}$');
ALTER TABLE public.users ADD COLUMN referral_locked boolean NOT NULL DEFAULT false;
UPDATE public.users SET referral_locked=true;
ALTER TABLE public.users ADD CONSTRAINT public_alias_required CHECK(NOT leaderboard_visible OR public_alias IS NOT NULL);
ALTER TABLE public.referrals ADD COLUMN qualified_at timestamptz;
ALTER TABLE public.referrals ADD COLUMN qualifying_attempt_id uuid UNIQUE REFERENCES public.lesson_attempts(id);
ALTER TABLE public.referrals ADD COLUMN rewarded_at timestamptz;
ALTER TABLE public.referrals ADD CONSTRAINT referral_qualification CHECK((qualified_at IS NULL)=(qualifying_attempt_id IS NULL) AND (rewarded_at IS NULL OR qualified_at IS NOT NULL));
ALTER TABLE public.coin_events DROP CONSTRAINT coin_events_reason_check;
ALTER TABLE public.coin_events ADD CONSTRAINT coin_events_reason_check CHECK(reason IN ('lesson','daily','achievement','unit','course','referral'));
-- Preserve paid credits if the invited user later deletes the account.
ALTER TABLE public.coin_events ALTER COLUMN attempt_id DROP NOT NULL;
ALTER TABLE public.coin_events DROP CONSTRAINT coin_events_attempt_id_fkey;
ALTER TABLE public.coin_events ADD CONSTRAINT coin_events_attempt_id_fkey FOREIGN KEY(attempt_id) REFERENCES public.lesson_attempts(id) ON DELETE SET NULL;
-- Relationship IDs/foreign attempt IDs are not client data. Only aggregate statistics leave the server.
REVOKE SELECT ON public.referrals FROM authenticated;
REVOKE SELECT ON public.coin_events FROM authenticated;
GRANT SELECT(id,user_id,source_key,reason,amount,created_at) ON public.coin_events TO authenticated;
CREATE FUNCTION public.set_social_privacy(p_user uuid,p_visible boolean,p_alias text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF p_visible IS NULL OR p_alias IS NULL OR length(trim(p_alias)) NOT BETWEEN 2 AND 32 OR p_alias ~ '[[:cntrl:]@/:]' THEN RAISE EXCEPTION 'invalid public alias'; END IF;
 UPDATE public.users SET leaderboard_visible=p_visible,public_alias=trim(p_alias) WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
END $$;
-- New-user attribution only; only the signed initData start_param reaches this function.
CREATE FUNCTION public.create_social_telegram_session(p_auth_id uuid,p_telegram_id bigint,p_name text,p_username text,p_avatar text,p_token_hash text,p_init_hash text,p_referral_code text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid; locked boolean; new_signup boolean;
BEGIN
 SELECT NOT EXISTS(SELECT 1 FROM public.users WHERE telegram_id=p_telegram_id) INTO new_signup;
 uid:=public.create_telegram_session(p_auth_id,p_telegram_id,p_name,p_username,p_avatar,p_token_hash,p_init_hash);
 SELECT referral_locked INTO locked FROM public.users WHERE id=uid FOR UPDATE;
 IF NOT locked THEN
  IF new_signup AND p_referral_code ~ '^[a-f0-9]{32}$' THEN
   INSERT INTO public.referrals(referrer_id,referred_id)
   SELECT u.id,uid FROM public.users u WHERE u.referral_code=p_referral_code AND u.id<>uid
    AND NOT EXISTS(SELECT 1 FROM public.user_progress WHERE user_id=uid)
   ON CONFLICT(referred_id) DO NOTHING;
  END IF;
  UPDATE public.users SET referral_locked=true WHERE id=uid;
 END IF;
 RETURN uid;
END $$;
CREATE FUNCTION public.qualify_social_referral() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ref public.referrals; paid integer; delta integer;
BEGIN
 IF OLD.gamification_processed OR NOT NEW.gamification_processed OR NEW.score<60 THEN RETURN NEW; END IF;
 SELECT * INTO ref FROM public.referrals WHERE referred_id=NEW.user_id;
 IF NOT FOUND OR ref.qualified_at IS NOT NULL THEN RETURN NEW; END IF;
 -- Serialize payouts for an inviter. Attribution only points from new to pre-existing users.
 PERFORM 1 FROM public.users WHERE id=ref.referrer_id FOR UPDATE;
 SELECT * INTO ref FROM public.referrals WHERE id=ref.id FOR UPDATE;
 IF ref.qualified_at IS NOT NULL THEN RETURN NEW; END IF;
 UPDATE public.referrals SET qualified_at=NEW.completed_at,qualifying_attempt_id=NEW.id WHERE id=ref.id;
 SELECT count(*) INTO paid FROM public.coin_events WHERE user_id=ref.referrer_id AND reason='referral';
 IF paid<10 THEN
  delta:=public.game_coin(ref.referrer_id,'referral:'||ref.id::text,'referral',25,NEW.id,NEW.completed_at);
  IF delta>0 THEN UPDATE public.referrals SET rewarded_at=NEW.completed_at WHERE id=ref.id; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER social_referral_completion AFTER UPDATE OF gamification_processed ON public.lesson_attempts FOR EACH ROW EXECUTE FUNCTION public.qualify_social_referral();
CREATE FUNCTION public.social_summary(p_user uuid,p_scope text DEFAULT 'weekly',p_offset integer DEFAULT 0) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE own public.users; start_at timestamptz; end_at timestamptz; rows jsonb; position bigint; own_xp bigint; population bigint; invited integer; qualified integer; rewarded integer; coins bigint;
BEGIN
 SELECT * INTO own FROM public.users WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
 IF p_scope NOT IN ('weekly','global') OR p_scope IS NULL OR p_offset IS NULL OR p_offset NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid ranking request'; END IF;
 start_at:=date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';end_at:=(date_trunc('week',now() AT TIME ZONE 'UTC')+interval '7 days') AT TIME ZONE 'UTC';
 WITH scores AS(SELECT u.id,u.public_alias,coalesce(sum(x.amount),0)::bigint AS xp FROM public.users u JOIN public.xp_events x ON x.user_id=u.id WHERE u.leaderboard_visible AND (p_scope='global' OR (x.created_at>=start_at AND x.created_at<end_at)) GROUP BY u.id,u.public_alias HAVING sum(x.amount)>0),
 ranked AS(SELECT id,public_alias,xp,rank() OVER(ORDER BY xp DESC) AS place FROM scores),
 page AS(SELECT * FROM ranked ORDER BY xp DESC,id OFFSET p_offset LIMIT 20)
 SELECT coalesce((SELECT jsonb_agg(jsonb_build_object('rank',place,'alias',public_alias,'xp',xp,'isMe',id=p_user) ORDER BY xp DESC,id) FROM page),'[]'),(SELECT place FROM ranked WHERE id=p_user),(SELECT count(*) FROM ranked) INTO rows,position,population;
 SELECT coalesce(sum(amount),0) INTO own_xp FROM public.xp_events WHERE user_id=p_user AND (p_scope='global' OR (created_at>=start_at AND created_at<end_at));
 SELECT count(*),count(*) FILTER(WHERE qualified_at IS NOT NULL),count(*) FILTER(WHERE rewarded_at IS NOT NULL) INTO invited,qualified,rewarded FROM public.referrals WHERE referrer_id=p_user;
 SELECT coalesce(sum(amount),0),count(*) INTO coins,rewarded FROM public.coin_events WHERE user_id=p_user AND reason='referral';
 RETURN jsonb_build_object('scope',p_scope,'weekStart',start_at,'weekEnd',end_at,'entries',rows,'total',population,'offset',p_offset,'myPosition',position,'myXp',own_xp,'privacy',jsonb_build_object('visible',own.leaderboard_visible,'alias',coalesce(own.public_alias,'')),
 'invitations',jsonb_build_object('code',own.referral_code,'invited',invited,'qualified',qualified,'rewarded',rewarded,'coins',coins,'rewardCoins',25,'rewardLimit',10));
END $$;
REVOKE ALL ON FUNCTION public.set_social_privacy(uuid,boolean,text),public.create_social_telegram_session(uuid,bigint,text,text,text,text,text,text),public.qualify_social_referral(),public.social_summary(uuid,text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.set_social_privacy(uuid,boolean,text),public.create_social_telegram_session(uuid,bigint,text,text,text,text,text,text),public.social_summary(uuid,text,integer) TO service_role;
CREATE OR REPLACE FUNCTION public.voklumi_database_status() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item text; rel oid; ok boolean:=true; writes_denied boolean; reads_denied boolean; enabled boolean; cols boolean; rpc_ok boolean; checks jsonb:='[]'; func record;
BEGIN
 FOREACH item IN ARRAY ARRAY['users','languages','courses','units','lessons','exercises','exercise_options','user_progress','lesson_attempts','xp_events','achievements','user_achievements','daily_streaks','referrals','subscriptions','telegram_sessions','lesson_attempt_items','exercise_submissions','coin_events'] LOOP
  rel:=pg_catalog.to_regclass('public.'||item);
  enabled:=false;writes_denied:=false;reads_denied:=true;
  IF rel IS NOT NULL THEN
   SELECT relrowsecurity INTO enabled FROM pg_catalog.pg_class WHERE oid=rel;
   SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_any_column_privilege(r.role,rel,'INSERT') OR pg_catalog.has_any_column_privilege(r.role,rel,'UPDATE') OR pg_catalog.has_table_privilege(r.role,rel,'DELETE,TRUNCATE')) INTO writes_denied;
   IF item IN ('telegram_sessions','lesson_attempt_items','exercise_submissions','referrals') THEN
    SELECT NOT EXISTS(SELECT 1 FROM (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_any_column_privilege(r.role,rel,'SELECT')) INTO reads_denied;
   END IF;
  END IF;
  ok:=ok AND rel IS NOT NULL AND enabled AND writes_denied AND reads_denied;
  checks:=checks||jsonb_build_array(jsonb_build_object('name',item,'exists',rel IS NOT NULL,'rls',enabled,'clientWritesDenied',writes_denied,'privateReadsDenied',reads_denied));
 END LOOP;
 SELECT NOT EXISTS(SELECT 1 FROM (VALUES('exercises','answer_key'),('exercises','explanation'),('exercise_options','is_correct'),('users','telegram_id'),('users','telegram_username'),('users','referral_code'),('coin_events','attempt_id'),('subscriptions','provider_reference')) c(tbl,col) CROSS JOIN (VALUES('anon'),('authenticated')) r(role) WHERE pg_catalog.has_column_privilege(r.role,'public.'||c.tbl,c.col,'SELECT')) INTO cols;
 rpc_ok:=true;
 FOR func IN SELECT signature FROM (VALUES('public.start_lesson(uuid,uuid,uuid)'),('public.lesson_state(uuid,uuid)'),('public.submit_lesson_answer(uuid,uuid,integer,jsonb)'),('public.award_completed_lesson(uuid)'),('public.create_telegram_session(uuid,bigint,text,text,text,text,text)'),('public.game_summary(uuid)'),('public.set_game_timezone(uuid,text)'),('public.import_english_curriculum(jsonb)'),('public.social_summary(uuid,text,integer)'),('public.set_social_privacy(uuid,boolean,text)'),('public.create_social_telegram_session(uuid,bigint,text,text,text,text,text,text)'),('public.voklumi_database_status()')) f(signature) LOOP
  rel:=pg_catalog.to_regprocedure(func.signature);
  IF rel IS NULL THEN rpc_ok:=false;
  ELSIF NOT pg_catalog.has_function_privilege('service_role',rel,'EXECUTE') OR pg_catalog.has_function_privilege('anon',rel,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',rel,'EXECUTE') THEN rpc_ok:=false; END IF;
 END LOOP;
 RETURN jsonb_build_object('schemaVersion','202611020008','ready',ok AND cols AND rpc_ok,'tables',checks,'protectedColumns',cols,'rpcPermissions',rpc_ok);
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;
