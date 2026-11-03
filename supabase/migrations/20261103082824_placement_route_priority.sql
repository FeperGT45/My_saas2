BEGIN;
-- Level proximity comes before novelty; completed suitable lessons can be reviewed.
CREATE OR REPLACE FUNCTION public.placement_recommendations(p_user uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE target text; suggestions jsonb;
BEGIN
 SELECT coalesce(u.english_route_level,ll.level,'A1') INTO target FROM public.users u LEFT JOIN public.user_language_levels ll ON ll.user_id=u.id AND ll.language_id=(SELECT id FROM public.languages WHERE code='en') WHERE u.id=p_user;
 SELECT coalesce(jsonb_agg((to_jsonb(r)-'distance'-'done')||jsonb_build_object('review',r.done) ORDER BY r.distance,r.done,r.course_id,r.unit_position,r.lesson_position),'[]') INTO suggestions FROM (
  SELECT c.id AS course_id,c.title AS course_title,c.level,u.title AS unit_title,u.position AS unit_position,l.id AS lesson_id,l.title AS lesson_title,l.position AS lesson_position,
   abs(public.placement_rank(c.level)-public.placement_rank(target)) AS distance,
   EXISTS(SELECT 1 FROM public.user_progress p WHERE p.user_id=p_user AND p.lesson_id=l.id AND p.best_score>=60) AS done
  FROM public.courses c JOIN public.languages lang ON lang.id=c.language_id JOIN public.units u ON u.course_id=c.id JOIN public.lessons l ON l.unit_id=u.id
  WHERE lang.code='en' AND lang.active AND c.published AND l.published AND public.can_access_lesson(p_user,l.id)
  AND NOT EXISTS(SELECT 1 FROM public.lessons prev JOIN public.units pu ON pu.id=prev.unit_id WHERE pu.course_id=c.id AND prev.published AND (pu.position<u.position OR (pu.position=u.position AND prev.position<l.position)) AND NOT EXISTS(SELECT 1 FROM public.user_progress p WHERE p.user_id=p_user AND p.lesson_id=prev.id AND p.best_score>=60))
  ORDER BY distance,done,c.created_at,c.id,u.position,l.position LIMIT 5
 ) r;
 RETURN suggestions;
END $$;
REVOKE ALL ON FUNCTION public.placement_recommendations(uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
