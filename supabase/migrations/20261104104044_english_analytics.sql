BEGIN;
-- Reuse learning_recent_completed_idx(user_id,completed_at DESC,id) and the (attempt_id,position) PKs.
-- No duplicate analytics event store, no changes to historical submissions or grading.
CREATE FUNCTION public.english_analytics(p_user uuid,p_days integer DEFAULT 30,p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE tz text; today date; begins date; ends_at timestamptz; begins_at timestamptz; previous_at timestamptz; report jsonb;
BEGIN
 IF p_days IS NULL OR p_days NOT IN(7,30,90) OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'analytics invalid period'; END IF;
 IF NOT public.has_feature(p_user,'advanced_statistics') THEN RAISE EXCEPTION 'premium required'; END IF;
 SELECT time_zone INTO tz FROM public.users WHERE id=p_user;
 IF tz IS NULL THEN RAISE EXCEPTION 'analytics unavailable'; END IF;
 today:=(now() AT TIME ZONE tz)::date; begins:=today-(p_days-1);
 begins_at:=begins::timestamp AT TIME ZONE tz; ends_at:=(today+1)::timestamp AT TIME ZONE tz; previous_at:=(begins-p_days)::timestamp AT TIME ZONE tz;
 WITH attempts AS MATERIALIZED (
  SELECT a.id,a.lesson_id,a.score,a.completed_at,(a.completed_at AT TIME ZONE tz)::date AS day,
   a.completed_at>=begins_at AS current,extract(epoch FROM a.completed_at-a.started_at)::numeric AS seconds,
   l.title,u.title AS unit_title,c.title AS course_title
  FROM public.lesson_attempts a JOIN public.lessons l ON l.id=a.lesson_id JOIN public.units u ON u.id=l.unit_id
  JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id
  WHERE a.user_id=p_user AND a.status='completed' AND a.completed_at>=previous_at AND a.completed_at<ends_at AND lang.code='en'
 ), graded AS MATERIALIZED (
  SELECT a.id,a.lesson_id,a.title,a.unit_title,a.course_title,a.day,a.current,s.correct,
   CASE WHEN i.kind IN('grammar','gap','sentence','word_order','error_identification','correction','tenses') THEN 'grammar'
   WHEN i.kind IN('translation','matching','spelling','synonym_antonym','word_review') THEN 'vocabulary'
   WHEN i.kind IN('reading','dialogue') THEN 'reading'
   WHEN i.kind IN('listening','dictation') THEN 'listening' ELSE 'unclassified' END AS skill
  FROM attempts a JOIN public.exercise_submissions s ON s.attempt_id=a.id
  JOIN public.lesson_attempt_items i ON i.attempt_id=s.attempt_id AND i.position=s.position
 ), attempt_stats AS (
  SELECT current,count(*) AS attempts,count(DISTINCT lesson_id) AS lessons,sum(seconds) AS seconds,round(avg(seconds)) AS average,
   round((percentile_cont(0.5) WITHIN GROUP(ORDER BY seconds))::numeric) AS median,count(*) FILTER(WHERE seconds>7200) AS long_attempts FROM attempts GROUP BY current
 ), answer_stats AS (
  SELECT current,count(*) AS answered,count(*) FILTER(WHERE correct) AS correct,
   round(100.0*count(*) FILTER(WHERE correct)/nullif(count(*),0),1) AS accuracy FROM graded GROUP BY current
 ), summaries AS (
  SELECT periods.current,jsonb_build_object('attempts',coalesce(a.attempts,0),'lessons',coalesce(a.lessons,0),
   'answered',coalesce(g.answered,0),'correct',coalesce(g.correct,0),'accuracy',g.accuracy,
   'elapsedSeconds',round(a.seconds),'averageSeconds',a.average,'medianSeconds',a.median,'longAttempts',coalesce(a.long_attempts,0)) AS body
  FROM (VALUES(true),(false)) periods(current) LEFT JOIN attempt_stats a USING(current) LEFT JOIN answer_stats g USING(current)
 ), skill_stats AS (
  SELECT current,skill,count(*) AS answered,count(*) FILTER(WHERE correct) AS correct,
   round(100.0*count(*) FILTER(WHERE correct)/nullif(count(*),0),1) AS accuracy FROM graded GROUP BY current,skill
 ), topics AS MATERIALIZED (
  SELECT lesson_id,title,unit_title,course_title,count(*) AS answered,count(*) FILTER(WHERE correct) AS correct,
   round(100.0*count(*) FILTER(WHERE correct)/nullif(count(*),0),1) AS accuracy FROM graded WHERE current GROUP BY lesson_id,title,unit_title,course_title
 ), daily_answers AS (
  SELECT day,count(*) AS answered,count(*) FILTER(WHERE correct) AS correct,
   round(100.0*count(*) FILTER(WHERE correct)/nullif(count(*),0),1) AS accuracy FROM graded WHERE current GROUP BY day
 ), daily_attempts AS (
  SELECT day,count(*) AS attempts,round(sum(seconds)) AS seconds FROM attempts WHERE current GROUP BY day
 ), history AS (
  SELECT a.* FROM attempts a WHERE current ORDER BY completed_at DESC,id DESC LIMIT 20 OFFSET p_offset
 )
 SELECT jsonb_build_object('version','analytics-v1','days',p_days,'timeZone',tz,'start',begins,'end',today,'previousStart',begins-p_days,'previousEnd',begins-1,
  'current',(SELECT body FROM summaries WHERE current),'previous',(SELECT body FROM summaries WHERE NOT current),
  'skills',(SELECT jsonb_agg(jsonb_build_object('skill',names.skill,'answered',coalesce(c.answered,0),'correct',coalesce(c.correct,0),'accuracy',c.accuracy,
   'previousAnswered',coalesce(p.answered,0),'previousCorrect',coalesce(p.correct,0),'previousAccuracy',p.accuracy) ORDER BY names.position)
   FROM (VALUES('grammar',1),('vocabulary',2),('reading',3),('listening',4)) names(skill,position)
   LEFT JOIN skill_stats c ON c.skill=names.skill AND c.current LEFT JOIN skill_stats p ON p.skill=names.skill AND NOT p.current),
  'unclassified',coalesce((SELECT answered FROM skill_stats WHERE current AND skill='unclassified'),0),
  'daily',(SELECT jsonb_agg(jsonb_build_object('date',begins+n,'answered',coalesce(g.answered,0),'correct',coalesce(g.correct,0),'accuracy',g.accuracy,
    'attempts',coalesce(a.attempts,0),'elapsedSeconds',a.seconds) ORDER BY n)
   FROM generate_series(0,p_days-1) n LEFT JOIN daily_answers g ON g.day=begins+n LEFT JOIN daily_attempts a ON a.day=begins+n),
  'topics',coalesce((SELECT jsonb_agg(jsonb_build_object('lessonId',lesson_id,'title',title,'unit',unit_title,'course',course_title,'answered',answered,'correct',correct,'accuracy',accuracy) ORDER BY accuracy,answered DESC,lesson_id) FROM topics),'[]'),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('attemptId',id,'lessonId',lesson_id,'title',title,'completedAt',completed_at,'score',score,'elapsedSeconds',round(seconds),'canOpen',public.can_access_lesson(p_user,lesson_id)) ORDER BY completed_at DESC,id DESC) FROM history),'[]'),
  'historyOffset',p_offset,'historyTotal',coalesce((SELECT attempts FROM attempt_stats WHERE current),0),
  'recommendations',coalesce((SELECT jsonb_agg(jsonb_build_object('lessonId',lesson_id,'title',title,'reason','weak_topic') ORDER BY accuracy,answered DESC,lesson_id) FROM (SELECT * FROM topics WHERE answered>=5 AND accuracy<60 AND public.can_access_lesson(p_user,lesson_id) ORDER BY accuracy,answered DESC,lesson_id LIMIT 3) w),'[]'),
  'context',public.learning_path_context(p_user)->'context') INTO report;
 RETURN report;
END $$;
REVOKE ALL ON FUNCTION public.english_analytics(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.english_analytics(uuid,integer,integer) TO service_role;
CREATE FUNCTION public.english_analytics_database_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','analytics-v1','ready',
 NOT has_function_privilege('anon','public.english_analytics(uuid,integer,integer)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.english_analytics(uuid,integer,integer)','EXECUTE')
 AND EXISTS(SELECT 1 FROM pg_catalog.pg_index WHERE indexrelid='public.learning_recent_completed_idx'::regclass AND indisvalid))
$$;
REVOKE ALL ON FUNCTION public.english_analytics_database_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.english_analytics_database_status() TO service_role;
COMMIT;
