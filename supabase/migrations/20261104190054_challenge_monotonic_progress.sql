BEGIN;
CREATE OR REPLACE FUNCTION public.challenge_sync(p_user uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE entry public.challenge_enrollments; amount integer; reached timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':challenges',0));
 FOR entry IN SELECT * FROM public.challenge_enrollments WHERE user_id=p_user AND completed_at IS NULL LOOP
  WITH unique_events AS(SELECT subject,min(happened_at) AS at FROM public.challenge_facts WHERE user_id=p_user AND kind=entry.kind AND happened_at>=entry.starts_at AND happened_at<entry.ends_at GROUP BY subject)
  SELECT count(*),(SELECT at FROM unique_events ORDER BY at,subject LIMIT 1 OFFSET entry.target-1) INTO amount,reached FROM unique_events;
  UPDATE public.challenge_enrollments SET progress=greatest(progress,least(entry.target,amount)),completed_at=coalesce(completed_at,reached) WHERE id=entry.id;
 END LOOP;
END $$;
COMMIT;
