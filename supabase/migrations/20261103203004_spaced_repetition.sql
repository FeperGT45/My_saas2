BEGIN;
CREATE TABLE public.word_reviews (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 word_key text NOT NULL, front text NOT NULL, back text NOT NULL,
 ease numeric NOT NULL DEFAULT 2.5 CHECK(ease>=1.3), interval_days integer NOT NULL DEFAULT 0 CHECK(interval_days>=0),
 repetitions integer NOT NULL DEFAULT 0, successes integer NOT NULL DEFAULT 0, errors integer NOT NULL DEFAULT 0,
 last_review timestamptz, due_at timestamptz NOT NULL DEFAULT now(), version integer NOT NULL DEFAULT 0,
 PRIMARY KEY(user_id,word_key)
);
CREATE INDEX word_reviews_due ON public.word_reviews(user_id,due_at);
CREATE TABLE public.word_review_events (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, request_id uuid NOT NULL,
 word_key text NOT NULL, version integer NOT NULL, rating integer NOT NULL CHECK(rating IN(0,3,4,5)),
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,request_id)
);
ALTER TABLE public.word_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.word_review_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.word_reviews,public.word_review_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.word_reviews,public.word_review_events TO service_role;

CREATE FUNCTION public.word_review_queue(p_user uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 INSERT INTO public.word_reviews(user_id,word_key,front,back)
 SELECT DISTINCT p_user,md5(lower(trim(v->>'en'))||chr(31)||lower(trim(v->>'ru'))),trim(v->>'en'),trim(v->>'ru')
 FROM public.user_progress p JOIN public.lessons l ON l.id=p.lesson_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(l.lexicon,'[]'::jsonb)) v
 WHERE p.user_id=p_user AND p.best_score>=60 AND length(trim(v->>'en')) BETWEEN 1 AND 200 AND length(trim(v->>'ru')) BETWEEN 1 AND 200
 ON CONFLICT DO NOTHING;
 SELECT jsonb_build_object('total',count(*),'due',count(*) FILTER(WHERE due_at<=now()),'cards',
 coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT word_key AS key,front,back,version FROM public.word_reviews WHERE user_id=p_user AND due_at<=now() ORDER BY due_at,word_key LIMIT 20)c),'[]'::jsonb),
 'nextDue',min(due_at) FILTER(WHERE due_at>now())) INTO result FROM public.word_reviews WHERE user_id=p_user;
 RETURN result;
END $$;

CREATE FUNCTION public.word_review_answer(p_user uuid,p_request uuid,p_word text,p_version integer,p_rating integer) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE card public.word_reviews; event public.word_review_events; n integer; days integer; factor numeric; result jsonb;
BEGIN
 IF p_rating IS NULL OR p_rating NOT IN(0,3,4,5) OR p_request IS NULL OR p_version IS NULL OR p_version<0 THEN RAISE EXCEPTION 'invalid review'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,91));
 SELECT * INTO event FROM public.word_review_events WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN
  IF event.word_key<>p_word OR event.version<>p_version OR event.rating<>p_rating THEN RAISE EXCEPTION 'review conflict'; END IF;
  RETURN event.result;
 END IF;
 SELECT * INTO card FROM public.word_reviews WHERE user_id=p_user AND word_key=p_word FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'review unavailable'; END IF;
 IF card.version<>p_version OR card.due_at>now() THEN RAISE EXCEPTION 'review conflict'; END IF;
 factor:=greatest(1.3,card.ease+0.1-(5-p_rating)*(0.08+(5-p_rating)*0.02));
 IF p_rating<3 THEN n:=0;days:=1;
 ELSE n:=card.repetitions+1; days:=CASE WHEN n=1 THEN 1 WHEN n=2 THEN 6 ELSE least(365,round(card.interval_days*card.ease)::integer) END; END IF;
 UPDATE public.word_reviews SET ease=factor,interval_days=days,repetitions=n,successes=successes+CASE WHEN p_rating>=3 THEN 1 ELSE 0 END,
 errors=errors+CASE WHEN p_rating<3 THEN 1 ELSE 0 END,last_review=now(),due_at=now()+make_interval(days=>days),version=version+1
 WHERE user_id=p_user AND word_key=p_word;
 result:=jsonb_build_object('intervalDays',days,'nextDue',now()+make_interval(days=>days));
 INSERT INTO public.word_review_events VALUES(p_user,p_request,p_word,p_version,p_rating,result,now());
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.word_review_queue(uuid),public.word_review_answer(uuid,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.word_review_queue(uuid),public.word_review_answer(uuid,uuid,text,integer,integer) TO service_role;
COMMIT;
