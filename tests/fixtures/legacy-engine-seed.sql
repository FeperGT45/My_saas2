-- Isolated engine compatibility fixture; includes audio formats, not the published Voklumi catalog.
-- Catalog only: no auth identities, fake subscriptions or personal data in the regular seed.
BEGIN;
INSERT INTO public.languages(id,code,name) VALUES('10000000-0000-0000-0000-000000000001','en','Английский');
INSERT INTO public.courses(id,language_id,slug,title,level,published) VALUES('20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','english-a1','Первый контакт','A1',true);
INSERT INTO public.units(id,course_id,title,position) VALUES('30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','Знакомство',1);
INSERT INTO public.lessons(id,unit_id,title,position,published) VALUES('40000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Привет, мир!',1,true);
INSERT INTO public.exercises(id,lesson_id,prompt,explanation,position) VALUES('50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Переведи: Привет!','Hello — приветствие.',1);
INSERT INTO public.exercise_options(exercise_id,label,position,is_correct) VALUES
('50000000-0000-0000-0000-000000000001','Hello',1,true),('50000000-0000-0000-0000-000000000001','Goodbye',2,false);
INSERT INTO public.achievements(code,title,description,target) VALUES('first_lesson','Первый контакт','Заверши первый урок',1),('week_streak','В ударе','Занимайся семь дней подряд',7) ON CONFLICT(code) DO NOTHING;
COMMIT;

BEGIN;
INSERT INTO public.lessons(id,unit_id,title,position,published,xp_reward) VALUES('40000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','На одной волне',2,true,30);
INSERT INTO public.exercises(lesson_id,kind,prompt,explanation,position,public_payload,answer_key) VALUES
('40000000-0000-0000-0000-000000000002','single_choice','Выбери перевод: привет','Hello — универсальное приветствие.',1,'{"options":[{"id":"bye","label":"Goodbye"},{"id":"hello","label":"Hello"}]}','{"value":"hello"}'),
('40000000-0000-0000-0000-000000000002','sentence','Составь: Я люблю читать','I like reading — я люблю читать. После like возможно окончание -ing.',2,'{"tokens":[{"id":"reading","label":"reading"},{"id":"i","label":"I"},{"id":"like","label":"like"}]}','{"value":["i","like","reading"]}'),
('40000000-0000-0000-0000-000000000002','gap','Вставь пропущенное слово','После I используется am: I am a student.',3,'{"sentence":"I ___ a student."}','{"accepted":["am"]}'),
('40000000-0000-0000-0000-000000000002','matching','Найди пары слов','Cat — кот, dog — собака.',4,'{"left":[{"id":"cat","label":"cat"},{"id":"dog","label":"dog"}],"right":[{"id":"dog_ru","label":"собака"},{"id":"cat_ru","label":"кот"}]}','{"pairs":{"cat":"cat_ru","dog":"dog_ru"}}'),
('40000000-0000-0000-0000-000000000002','grammar','Выбери правильную форму: She ___ English.','В Present Simple после she добавляется -s: She speaks English.',5,'{"options":[{"id":"speak","label":"speak"},{"id":"speaks","label":"speaks"}]}','{"value":"speaks"}'),
('40000000-0000-0000-0000-000000000002','listening','Послушай и выбери перевод','Good morning — доброе утро.',6,'{"text":"Good morning","lang":"en-US","options":[{"id":"night","label":"Спокойной ночи"},{"id":"morning","label":"Доброе утро"}]}','{"value":"morning"}');
COMMIT;
