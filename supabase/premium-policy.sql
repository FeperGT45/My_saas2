-- OWNER REVIEW ONLY. Apply after catalog import on staging, not as an automatic migration.
-- Basic English remains free; Gaming and Internet courses have two free previews each.
BEGIN;
UPDATE public.courses SET access_tier='premium' WHERE slug IN ('en-ru-gaming-v1','en-ru-internet-v1');
WITH ranked AS(SELECT l.id,row_number() OVER(PARTITION BY c.id ORDER BY u.position,l.position) AS n FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id WHERE c.slug IN ('en-ru-gaming-v1','en-ru-internet-v1'))
UPDATE public.lessons l SET free_preview=(r.n<=2) FROM ranked r WHERE r.id=l.id;
COMMIT;
