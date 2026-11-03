BEGIN;
CREATE OR REPLACE FUNCTION public.learner_statistics(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
WITH words AS (
 SELECT DISTINCT md5(lower(trim(v->>'en'))||chr(31)||lower(trim(v->>'ru'))) AS key
 FROM public.user_progress p JOIN public.lessons l ON l.id=p.lesson_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(l.lexicon,'[]'::jsonb)) v
 WHERE p.user_id=p_user AND p.best_score>=60 AND length(trim(v->>'en')) BETWEEN 1 AND 200 AND length(trim(v->>'ru')) BETWEEN 1 AND 200
), answers AS (SELECT s.correct FROM public.exercise_submissions s JOIN public.lesson_attempts a ON a.id=s.attempt_id WHERE a.user_id=p_user)
SELECT jsonb_build_object(
 'passedLessons',(SELECT count(*) FROM public.user_progress WHERE user_id=p_user AND best_score>=60),
 'completedAttempts',(SELECT count(*) FROM public.lesson_attempts WHERE user_id=p_user AND status='completed'),
 'answered',(SELECT count(*) FROM answers),'correct',(SELECT count(*) FROM answers WHERE correct),
 'accuracy',(SELECT round(100.0*count(*) FILTER(WHERE correct)/nullif(count(*),0)) FROM answers),
 'attemptMinutes',(SELECT round(sum(extract(epoch from completed_at-started_at))/60) FROM public.lesson_attempts WHERE user_id=p_user AND status='completed'),
 'words',(SELECT count(*) FROM words),
 'dueWords',(SELECT count(*) FROM words w LEFT JOIN public.word_reviews r ON r.word_key=w.key AND r.user_id=p_user WHERE r.due_at IS NULL OR r.due_at<=now()),
 'reviews',(SELECT count(*) FROM public.word_review_events WHERE user_id=p_user),
 'checkpointIds',coalesce((SELECT jsonb_agg(l.id ORDER BY l.id) FROM public.lessons l WHERE l.published AND EXISTS(SELECT 1 FROM public.exercises e WHERE e.lesson_id=l.id AND e.kind='unit_test')),'[]'::jsonb)
);
$$;
REVOKE ALL ON FUNCTION public.learner_statistics(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.learner_statistics(uuid) TO service_role;
COMMIT;
