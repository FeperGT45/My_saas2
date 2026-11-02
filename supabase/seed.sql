-- Catalog only: no auth identities, fake subscriptions or personal data in the regular seed.
BEGIN;
INSERT INTO public.languages(id,code,name) VALUES('10000000-0000-0000-0000-000000000001','en','Английский');
INSERT INTO public.courses(id,language_id,slug,title,level,published) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','english-a1','Первый контакт','A1',true);
INSERT INTO public.units(id,course_id,title,position) VALUES('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Знакомство',1);
INSERT INTO public.lessons(id,unit_id,title,position,published) VALUES('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Привет, мир!',1,true);
INSERT INTO public.exercises(id,lesson_id,prompt,explanation,position) VALUES('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Переведи: Привет!','Hello — приветствие.',1);
INSERT INTO public.exercise_options(exercise_id,label,position,is_correct) VALUES
('50000000-0000-0000-0000-000000000001','Hello',1,true),('50000000-0000-0000-0000-000000000001','Goodbye',2,false);
INSERT INTO public.achievements(code,title,description,target) VALUES('first_lesson','Первый контакт','Заверши первый урок',1),('week_streak','В ударе','Занимайся семь дней подряд',7);
COMMIT;
