BEGIN;
-- Explicit allowlist; no browser writes, even with an authenticated JWT.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['users','languages','courses','units','lessons','exercises','exercise_options','user_progress','lesson_attempts','xp_events','achievements','user_achievements','daily_streaks','referrals','subscriptions'] LOOP
 EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated',t);
 EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
GRANT SELECT ON public.languages,public.courses,public.units,public.lessons,public.achievements TO anon,authenticated;
GRANT SELECT(id,lesson_id,kind,prompt,position) ON public.exercises TO anon,authenticated;
GRANT SELECT(id,exercise_id,label,position) ON public.exercise_options TO anon,authenticated;
GRANT SELECT(id,display_name,locale,created_at) ON public.users TO authenticated;
GRANT SELECT ON public.user_progress,public.lesson_attempts,public.xp_events,public.user_achievements,public.daily_streaks,public.referrals TO authenticated;
GRANT SELECT(id,user_id,plan,status,starts_at,ends_at) ON public.subscriptions TO authenticated;
CREATE POLICY languages_read ON public.languages FOR SELECT TO anon,authenticated USING(active);
CREATE POLICY courses_read ON public.courses FOR SELECT TO anon,authenticated USING(published AND EXISTS(SELECT 1 FROM public.languages l WHERE l.id=language_id));
CREATE POLICY units_read ON public.units FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM public.courses c WHERE c.id=course_id));
CREATE POLICY lessons_read ON public.lessons FOR SELECT TO anon,authenticated USING(published AND EXISTS(SELECT 1 FROM public.units u WHERE u.id=unit_id));
CREATE POLICY exercises_read ON public.exercises FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM public.lessons l WHERE l.id=lesson_id));
CREATE POLICY options_read ON public.exercise_options FOR SELECT TO anon,authenticated USING(EXISTS(SELECT 1 FROM public.exercises e WHERE e.id=exercise_id));
CREATE POLICY achievements_read ON public.achievements FOR SELECT TO anon,authenticated USING(active);
CREATE POLICY own_user ON public.users FOR SELECT TO authenticated USING(id=(SELECT auth.uid()));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['user_progress','lesson_attempts','xp_events','user_achievements','daily_streaks','subscriptions'] LOOP
 EXECUTE format('CREATE POLICY own_read ON public.%I FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()))',t);
 END LOOP;
END $$;
CREATE POLICY own_referrals ON public.referrals FOR SELECT TO authenticated USING(referrer_id=(SELECT auth.uid()) OR referred_id=(SELECT auth.uid()));
REVOKE ALL ON FUNCTION public.check_exercise_options() FROM PUBLIC,anon,authenticated;
-- Trusted grader calls only AFTER checking answers and recording a completed attempt.
-- Award/progress/streak are atomic; per-lesson uniqueness prevents XP farming.
CREATE FUNCTION public.award_completed_lesson(p_attempt_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.lesson_attempts; reward integer; inserted integer;
BEGIN
 SELECT * INTO a FROM public.lesson_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF NOT FOUND OR a.status<>'completed' THEN RAISE EXCEPTION 'completed attempt required'; END IF;
 SELECT xp_reward INTO STRICT reward FROM public.lessons WHERE id=a.lesson_id;
 INSERT INTO public.xp_events(user_id,lesson_id,attempt_id,amount) VALUES(a.user_id,a.lesson_id,a.id,reward) ON CONFLICT(user_id,lesson_id) DO NOTHING;
 GET DIAGNOSTICS inserted = ROW_COUNT;
 INSERT INTO public.user_progress(user_id,lesson_id,best_score,completed_at) VALUES(a.user_id,a.lesson_id,a.score,a.completed_at)
 ON CONFLICT(user_id,lesson_id) DO UPDATE SET best_score=greatest(public.user_progress.best_score,excluded.best_score);
 INSERT INTO public.daily_streaks(user_id,activity_date) VALUES(a.user_id,(a.completed_at AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING;
 RETURN inserted=1;
END $$;
REVOKE ALL ON FUNCTION public.award_completed_lesson(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.award_completed_lesson(uuid) TO service_role;
COMMIT;
