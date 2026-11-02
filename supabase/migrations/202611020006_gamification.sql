BEGIN;
ALTER TABLE public.users ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE public.daily_streaks ADD COLUMN time_zone text NOT NULL DEFAULT 'UTC';
ALTER TABLE public.lesson_attempts ADD COLUMN gamification_processed boolean NOT NULL DEFAULT false;
ALTER TABLE public.lesson_attempts ADD COLUMN reward_summary jsonb NOT NULL DEFAULT '{}';
-- No surprise retroactive coin payouts. Historical XP and UTC activity stay intact.
UPDATE public.lesson_attempts SET gamification_processed=true WHERE status='completed';
ALTER TABLE public.achievements ADD COLUMN coin_reward integer NOT NULL DEFAULT 0 CHECK(coin_reward BETWEEN 0 AND 1000);
INSERT INTO public.achievements(code,title,description,target,coin_reward) VALUES
('first_lesson','Первый контакт','Впервые пройди урок с результатом от 60%.',1,15),
('week_streak','На одной волне','Занимайся 7 дней подряд.',7,50),
('xp_1000','Искра знаний','Набери 1 000 XP.',1000,25),
('ten_lessons','Исследователь','Зачти 10 разных уроков.',10,30)
ON CONFLICT(code) DO UPDATE SET title=excluded.title,description=excluded.description,target=excluded.target,coin_reward=excluded.coin_reward;
CREATE TABLE public.coin_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 source_key text NOT NULL CHECK(length(source_key) BETWEEN 1 AND 160),
 reason text NOT NULL CHECK(reason IN ('lesson','daily','achievement','unit','course')),
 amount integer NOT NULL CHECK(amount BETWEEN 1 AND 1000),
 attempt_id uuid NOT NULL REFERENCES public.lesson_attempts(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,source_key)
);
CREATE INDEX coin_events_attempt_idx ON public.coin_events(attempt_id);
CREATE INDEX coin_events_user_time_idx ON public.coin_events(user_id,created_at DESC);
ALTER TABLE public.coin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.coin_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.coin_events TO authenticated;
GRANT ALL ON public.coin_events TO service_role;
CREATE POLICY coin_own_read ON public.coin_events FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE FUNCTION public.game_level(p_xp bigint) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT floor((1+sqrt(1+greatest(p_xp,0)::numeric/12.5))/2)::integer
$$;
CREATE FUNCTION public.game_streak(p_user uuid,p_today date) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 WITH days AS (SELECT activity_date,activity_date-(row_number() OVER(ORDER BY activity_date))::integer AS grp FROM public.daily_streaks WHERE user_id=p_user AND activity_date<=p_today),
 runs AS (SELECT count(*)::integer AS size,max(activity_date) AS last_day FROM days GROUP BY grp)
 SELECT jsonb_build_object('current',coalesce(max(size) FILTER(WHERE last_day>=p_today-1),0),'longest',coalesce(max(size),0)) FROM runs
$$;
CREATE FUNCTION public.game_coin(p_user uuid,p_key text,p_reason text,p_amount integer,p_attempt uuid,p_at timestamptz) RETURNS integer
LANGUAGE plpgsql SET search_path='' AS $$
DECLARE inserted integer;
BEGIN
 INSERT INTO public.coin_events(user_id,source_key,reason,amount,attempt_id,created_at) VALUES(p_user,p_key,p_reason,p_amount,p_attempt,p_at) ON CONFLICT(user_id,source_key) DO NOTHING;
 GET DIAGNOSTICS inserted=ROW_COUNT; RETURN inserted*p_amount;
END $$;
CREATE FUNCTION public.set_game_timezone(p_user uuid,p_zone text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names WHERE name=p_zone) THEN RAISE EXCEPTION 'invalid time zone'; END IF;
 IF EXISTS(SELECT 1 FROM public.daily_streaks WHERE user_id=p_user) THEN RAISE EXCEPTION 'time zone locked'; END IF;
 UPDATE public.users SET time_zone=p_zone WHERE id=p_user;
END $$;
CREATE FUNCTION public.game_summary(p_user uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE tz text; today date; xp bigint; lvl integer; low bigint; high bigint; coins bigint; daily integer; badges jsonb; sections jsonb;
BEGIN
 SELECT time_zone INTO tz FROM public.users WHERE id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
 today:=(now() AT TIME ZONE tz)::date;
 SELECT coalesce(sum(amount),0) INTO xp FROM public.xp_events WHERE user_id=p_user;
 lvl:=public.game_level(xp);low:=50::bigint*(lvl-1)*lvl;high:=50::bigint*lvl*(lvl+1);
 SELECT coalesce(sum(amount),0) INTO coins FROM public.coin_events WHERE user_id=p_user;
 SELECT count(*) INTO daily FROM public.xp_events WHERE user_id=p_user AND (created_at AT TIME ZONE tz)::date=today;
 SELECT coalesce(jsonb_agg(jsonb_build_object('code',a.code,'title',a.title,'description',a.description,'coins',a.coin_reward,'unlocked',ua.user_id IS NOT NULL) ORDER BY a.target,a.code),'[]') INTO badges
 FROM public.achievements a LEFT JOIN public.user_achievements ua ON ua.achievement_id=a.id AND ua.user_id=p_user WHERE a.active;
 SELECT coalesce(jsonb_agg(jsonb_build_object('title',CASE WHEN ce.reason='unit' THEN u.title ELSE c.title END,'coins',ce.amount,'kind',ce.reason) ORDER BY ce.created_at DESC),'[]') INTO sections
 FROM public.coin_events ce LEFT JOIN public.units u ON ce.source_key='unit:'||u.id::text LEFT JOIN public.courses c ON ce.source_key='course:'||c.id::text WHERE ce.user_id=p_user AND ce.reason IN ('unit','course');
 RETURN jsonb_build_object('xp',xp,'level',lvl,'levelFloor',low,'nextLevelXp',high,'levelProgress',floor(100.0*(xp-low)/(high-low)),'coins',coins,'timeZone',tz,'timeZoneLocked',EXISTS(SELECT 1 FROM public.daily_streaks WHERE user_id=p_user),'today',today,
 'streak',public.game_streak(p_user,today),'completedLessons',(SELECT count(*) FROM public.user_progress WHERE user_id=p_user AND best_score>=60),'achievements',badges,'sections',sections,
 'daily',jsonb_build_array(jsonb_build_object('id','one','title','Один новый урок','target',1,'progress',least(daily,1),'coins',10,'claimed',EXISTS(SELECT 1 FROM public.coin_events WHERE user_id=p_user AND source_key='daily:'||today::text||':one')),jsonb_build_object('id','three','title','Три новых урока','target',3,'progress',least(daily,3),'coins',20,'claimed',EXISTS(SELECT 1 FROM public.coin_events WHERE user_id=p_user AND source_key='daily:'||today::text||':three'))));
END $$;
CREATE OR REPLACE FUNCTION public.award_completed_lesson(p_attempt_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.lesson_attempts; tz text; day date; reward integer; inserted integer:=0; xp_before bigint; xp_after bigint; streak integer; learned integer; daily integer; badge record; granted uuid; unit_id uuid; course_id uuid; section record; badges jsonb:='[]'; sections jsonb:='[]'; quests jsonb:='[]'; coins integer:=0; delta integer;
BEGIN
 SELECT * INTO a FROM public.lesson_attempts WHERE id=p_attempt_id;
 IF NOT FOUND OR a.status<>'completed' THEN RAISE EXCEPTION 'completed attempt required'; END IF;
 -- Consistent lock order with start/submit/timezone: user, then attempt.
 SELECT time_zone INTO tz FROM public.users WHERE id=a.user_id FOR UPDATE;
 SELECT * INTO a FROM public.lesson_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF a.gamification_processed THEN RETURN false; END IF;
 SELECT coalesce(sum(amount),0) INTO xp_before FROM public.xp_events WHERE user_id=a.user_id;
 INSERT INTO public.user_progress(user_id,lesson_id,best_score,completed_at) VALUES(a.user_id,a.lesson_id,a.score,a.completed_at)
 ON CONFLICT(user_id,lesson_id) DO UPDATE SET best_score=greatest(public.user_progress.best_score,excluded.best_score);
 IF a.score>=60 THEN
  day:=(a.completed_at AT TIME ZONE tz)::date;
  SELECT coalesce(a.xp_reward_snapshot,l.xp_reward),l.unit_id,u.course_id INTO reward,unit_id,course_id FROM public.lessons l JOIN public.units u ON u.id=l.unit_id WHERE l.id=a.lesson_id;
  INSERT INTO public.xp_events(user_id,lesson_id,attempt_id,amount,created_at) VALUES(a.user_id,a.lesson_id,a.id,reward,a.completed_at) ON CONFLICT(user_id,lesson_id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  INSERT INTO public.daily_streaks(user_id,activity_date,time_zone,created_at) VALUES(a.user_id,day,tz,a.completed_at) ON CONFLICT DO NOTHING;
  IF inserted=1 THEN coins:=coins+public.game_coin(a.user_id,'lesson:'||a.lesson_id::text,'lesson',5,a.id,a.completed_at); END IF;
  SELECT count(*) INTO daily FROM public.xp_events WHERE user_id=a.user_id AND (created_at AT TIME ZONE tz)::date=day;
  IF daily>=1 THEN delta:=public.game_coin(a.user_id,'daily:'||day::text||':one','daily',10,a.id,a.completed_at);coins:=coins+delta;IF delta>0 THEN quests:=quests||jsonb_build_array('Один новый урок'); END IF; END IF;
  IF daily>=3 THEN delta:=public.game_coin(a.user_id,'daily:'||day::text||':three','daily',20,a.id,a.completed_at);coins:=coins+delta;IF delta>0 THEN quests:=quests||jsonb_build_array('Три новых урока'); END IF; END IF;
  SELECT coalesce(sum(amount),0) INTO xp_after FROM public.xp_events WHERE user_id=a.user_id;
  streak:=(public.game_streak(a.user_id,day)->>'current')::integer;
  SELECT count(*) INTO learned FROM public.user_progress WHERE user_id=a.user_id AND best_score>=60;
  FOR badge IN SELECT * FROM public.achievements WHERE active AND ((code='first_lesson' AND learned>=1) OR (code='week_streak' AND streak>=7) OR (code='xp_1000' AND xp_after>=1000) OR (code='ten_lessons' AND learned>=10)) LOOP
   granted:=NULL;
   INSERT INTO public.user_achievements(user_id,achievement_id,awarded_at) VALUES(a.user_id,badge.id,a.completed_at) ON CONFLICT DO NOTHING RETURNING achievement_id INTO granted;
   IF granted IS NOT NULL THEN
    IF badge.coin_reward>0 THEN coins:=coins+public.game_coin(a.user_id,'achievement:'||badge.id::text,'achievement',badge.coin_reward,a.id,a.completed_at); END IF;
    badges:=badges||jsonb_build_array(badge.title);
   END IF;
  END LOOP;
  FOR section IN
   SELECT 'unit'::text AS kind,u.id,u.title,50 AS bonus FROM public.units u WHERE u.id=unit_id AND EXISTS(SELECT 1 FROM public.lessons l WHERE l.unit_id=u.id AND l.published) AND NOT EXISTS(SELECT 1 FROM public.lessons l WHERE l.unit_id=u.id AND l.published AND NOT EXISTS(SELECT 1 FROM public.user_progress p WHERE p.user_id=a.user_id AND p.lesson_id=l.id AND p.best_score>=60))
   UNION ALL
   SELECT 'course',c.id,c.title,100 FROM public.courses c WHERE c.id=course_id AND c.published AND EXISTS(SELECT 1 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id WHERE u.course_id=c.id AND l.published) AND NOT EXISTS(SELECT 1 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id WHERE u.course_id=c.id AND l.published AND NOT EXISTS(SELECT 1 FROM public.user_progress p WHERE p.user_id=a.user_id AND p.lesson_id=l.id AND p.best_score>=60))
  LOOP
   delta:=public.game_coin(a.user_id,section.kind||':'||section.id::text,section.kind,section.bonus,a.id,a.completed_at);coins:=coins+delta;
   IF delta>0 THEN sections:=sections||jsonb_build_array(section.title); END IF;
  END LOOP;
 END IF;
 SELECT coalesce(sum(amount),0) INTO xp_after FROM public.xp_events WHERE user_id=a.user_id;
 UPDATE public.lesson_attempts SET gamification_processed=true,reward_summary=jsonb_build_object('eligible',a.score>=60,'coins',coins,'levelBefore',public.game_level(xp_before),'levelAfter',public.game_level(xp_after),'achievements',badges,'sections',sections,'daily',quests,'streak',coalesce((public.game_streak(a.user_id,(a.completed_at AT TIME ZONE tz)::date)->>'current')::integer,0)) WHERE id=a.id;
 RETURN inserted=1;
END $$;
REVOKE ALL ON FUNCTION public.game_level(bigint),public.game_streak(uuid,date),public.game_coin(uuid,text,text,integer,uuid,timestamptz),public.game_summary(uuid),public.set_game_timezone(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.game_summary(uuid),public.set_game_timezone(uuid,text) TO service_role;
CREATE OR REPLACE FUNCTION public.lesson_state(p_user uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.lesson_attempts; item public.lesson_attempt_items; total integer; answered integer; correct_count integer; xp integer;
BEGIN
 SELECT * INTO a FROM public.lesson_attempts WHERE id=p_attempt AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'attempt unavailable'; END IF;
 IF a.status='abandoned' THEN RAISE EXCEPTION 'attempt closed'; END IF;
 SELECT count(*) INTO total FROM public.lesson_attempt_items WHERE attempt_id=a.id;
 SELECT count(*),count(*) FILTER(WHERE correct) INTO answered,correct_count FROM public.exercise_submissions WHERE attempt_id=a.id;
 SELECT * INTO item FROM public.lesson_attempt_items i WHERE i.attempt_id=a.id AND NOT EXISTS(SELECT 1 FROM public.exercise_submissions s WHERE s.attempt_id=i.attempt_id AND s.position=i.position) ORDER BY i.position LIMIT 1;
 SELECT coalesce(sum(amount),0) INTO xp FROM public.xp_events WHERE attempt_id=a.id;
 RETURN jsonb_build_object('attemptId',a.id,'lessonId',a.lesson_id,'status',a.status,'total',total,'answered',answered,'correct',correct_count,'score',a.score,'xp',xp,'rewards',a.reward_summary,
  'exercise',CASE WHEN item.position IS NULL THEN NULL ELSE jsonb_build_object('position',item.position,'kind',item.kind,'prompt',item.prompt,'payload',item.payload) END);
END $$;

CREATE OR REPLACE FUNCTION public.submit_lesson_answer(p_user uuid,p_attempt uuid,p_position integer,p_answer jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.lesson_attempts; item public.lesson_attempt_items; previous public.exercise_submissions; ok boolean; feedback text; total integer; done integer;
BEGIN
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 SELECT * INTO a FROM public.lesson_attempts WHERE id=p_attempt AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'attempt unavailable'; END IF;
 IF p_answer IS NULL OR octet_length(p_answer::text)>4096 THEN RAISE EXCEPTION 'invalid answer'; END IF;
 SELECT * INTO previous FROM public.exercise_submissions WHERE attempt_id=a.id AND position=p_position;
 IF FOUND THEN
  IF previous.answer<>p_answer THEN RAISE EXCEPTION 'answer already submitted'; END IF;
  RETURN jsonb_build_object('correct',previous.correct,'explanation',previous.feedback,'state',public.lesson_state(p_user,p_attempt));
 END IF;
 IF a.status<>'started' THEN RAISE EXCEPTION 'attempt closed'; END IF;
 IF p_position<>(SELECT count(*)+1 FROM public.exercise_submissions WHERE attempt_id=a.id) THEN RAISE EXCEPTION 'answer out of order'; END IF;
 SELECT * INTO item FROM public.lesson_attempt_items WHERE attempt_id=a.id AND position=p_position;
 IF NOT FOUND THEN RAISE EXCEPTION 'exercise unavailable'; END IF;
 IF NOT coalesce(public.lesson_key_valid(item.kind,item.payload,CASE WHEN item.kind='matching' THEN jsonb_build_object('pairs',p_answer) WHEN item.kind='gap' THEN jsonb_build_object('accepted',jsonb_build_array(p_answer)) ELSE jsonb_build_object('value',p_answer) END),false) THEN RAISE EXCEPTION 'invalid answer'; END IF;
 ok:=coalesce(public.lesson_grade(item.kind,item.answer_key,p_answer),false);
 feedback:=CASE WHEN item.explanation<>'' THEN item.explanation ELSE CASE WHEN ok THEN 'Ответ верный.' ELSE 'Ответ не совпал с ожидаемым. Повтори урок для закрепления.' END END;
 INSERT INTO public.exercise_submissions(attempt_id,position,answer,correct,feedback) VALUES(a.id,p_position,p_answer,ok,feedback);
 SELECT count(*) INTO total FROM public.lesson_attempt_items WHERE attempt_id=a.id;
 SELECT count(*) INTO done FROM public.exercise_submissions WHERE attempt_id=a.id;
 IF done=total THEN
  UPDATE public.lesson_attempts SET status='completed',completed_at=now(),score=(SELECT round(100.0*count(*) FILTER(WHERE correct)/total)::integer FROM public.exercise_submissions WHERE attempt_id=a.id) WHERE id=a.id;
  PERFORM public.award_completed_lesson(a.id);
 END IF;
 RETURN jsonb_build_object('correct',ok,'explanation',feedback,'state',public.lesson_state(p_user,p_attempt));
END $$;

COMMIT;
