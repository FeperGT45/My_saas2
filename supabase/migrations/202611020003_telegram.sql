BEGIN;
ALTER TABLE public.users ADD COLUMN avatar_url text CHECK(avatar_url IS NULL OR avatar_url LIKE 'https://%');
ALTER TABLE public.users ADD COLUMN telegram_username text;
GRANT SELECT(avatar_url) ON public.users TO authenticated;
CREATE TABLE public.telegram_sessions (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[0-9a-f]{64}$'),
 init_hash text NOT NULL UNIQUE CHECK(init_hash ~ '^[0-9a-f]{64}$'),
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 expires_at timestamptz NOT NULL DEFAULT now()+interval '1 day',
 created_at timestamptz NOT NULL DEFAULT now(), CHECK(expires_at>created_at)
);
CREATE INDEX telegram_sessions_user_idx ON public.telegram_sessions(user_id);
CREATE INDEX telegram_sessions_expiry_idx ON public.telegram_sessions(expires_at);
ALTER TABLE public.telegram_sessions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.telegram_sessions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.telegram_sessions TO service_role;
-- Server has already verified HMAC, age, and extracted every identity field.
-- A random Auth identity is created by admin API only on first login.
CREATE FUNCTION public.create_telegram_session(p_auth_id uuid,p_telegram_id bigint,p_name text,p_username text,p_avatar text,p_token_hash text,p_init_hash text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE uid uuid;
BEGIN
 INSERT INTO public.users(id,telegram_id,display_name,telegram_username,avatar_url)
 VALUES(p_auth_id,p_telegram_id,p_name,p_username,p_avatar)
 ON CONFLICT(telegram_id) DO UPDATE SET display_name=excluded.display_name,telegram_username=excluded.telegram_username,avatar_url=excluded.avatar_url
 RETURNING id INTO uid;
 INSERT INTO public.telegram_sessions(token_hash,init_hash,user_id) VALUES(p_token_hash,p_init_hash,uid);
 RETURN uid;
END $$;
REVOKE ALL ON FUNCTION public.create_telegram_session(uuid,bigint,text,text,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.create_telegram_session(uuid,bigint,text,text,text,text,text) TO service_role;
COMMIT;
