BEGIN;
CREATE TABLE public.challenge_cosmetics(code text PRIMARY KEY,title text NOT NULL,description text NOT NULL,slot text NOT NULL CHECK(slot IN('badge','frame','accent')),tone text NOT NULL CHECK(tone IN('violet','cyan','amber','rose','emerald','indigo')),symbol text NOT NULL CHECK(symbol IN('book','spark','bolt','trophy','leaf','target')));
INSERT INTO public.challenge_cosmetics VALUES
 ('mint-leaf','Лист знаний','Значок за знакомство с новыми словами.','badge','emerald','leaf'),
 ('orbit-frame','Орбита','Рамка за пять разных уроков.','frame','violet','trophy'),
 ('syntax-frame','Линии смысла','Рамка за практику трёх грамматических тем.','frame','cyan','target'),
 ('story-star','Рассказчик','Значок за завершённую историю.','badge','amber','book'),
 ('ocean-accent','Морской свет','Цвет витрины за повторение слов.','accent','cyan','spark'),
 ('sunset-accent','Тёплый ритм','Цвет витрины за короткую практику в своём темпе.','accent','rose','bolt');
CREATE TABLE public.premium_challenge_templates(code text PRIMARY KEY,title text NOT NULL,description text NOT NULL,kind text NOT NULL CHECK(kind IN('word_new','word_review','lesson','grammar','story','sprint')),target integer NOT NULL CHECK(target BETWEEN 1 AND 30),reward_code text NOT NULL REFERENCES public.challenge_cosmetics(code));
CREATE INDEX challenge_template_reward ON public.premium_challenge_templates(reward_code);
INSERT INTO public.premium_challenge_templates VALUES
 ('new-words','20 новых слов','Впервые успешно повтори 20 разных английских слов. Это практика вспоминания, не проверка полного запоминания.','word_new',20,'mint-leaf'),
 ('five-lessons','Пять открытий','Заверши 5 разных английских уроков с результатом от 60%.','lesson',5,'orbit-frame'),
 ('grammar-marathon','Линии грамматики','Заверши тренировки трёх разных грамматических тем с результатом от 60%. Если истории ошибок мало, можно выбрать другое испытание.','grammar',3,'syntax-frame'),
 ('one-story','Своя развязка','Дочитай одну интерактивную историю до любой концовки.','story',1,'story-star'),
 ('word-review','Вернуться к словам','Повтори 30 разных английских слов. Ошибки тоже считаются практикой.','word_review',30,'ocean-accent'),
 ('gentle-sprint','Пять минут для себя','Ответь на 5 коротких заданий. Ориентир — 5 минут; можно скрыть часы и продолжать дольше. Награда та же при любом темпе и результате.','sprint',1,'sunset-accent');
CREATE TABLE public.challenge_enrollments(
 id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,code text NOT NULL REFERENCES public.premium_challenge_templates(code),edition date NOT NULL,
 title text NOT NULL,kind text NOT NULL,target integer NOT NULL CHECK(target BETWEEN 1 AND 30),reward_code text NOT NULL REFERENCES public.challenge_cosmetics(code),
 starts_at timestamptz NOT NULL DEFAULT now(),ends_at timestamptz NOT NULL DEFAULT now()+interval '7 days',progress integer NOT NULL DEFAULT 0 CHECK(progress>=0),completed_at timestamptz,claimed_at timestamptz,
 CHECK(ends_at>starts_at),CHECK(completed_at IS NULL OR (completed_at>=starts_at AND completed_at<ends_at)),
 UNIQUE(user_id,code,edition),UNIQUE(id,user_id)
);
CREATE INDEX challenge_enroll_code ON public.challenge_enrollments(code);
CREATE INDEX challenge_enroll_reward ON public.challenge_enrollments(reward_code);
CREATE INDEX challenge_enroll_user ON public.challenge_enrollments(user_id,starts_at DESC);
CREATE TABLE public.challenge_owned(user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,cosmetic_code text NOT NULL REFERENCES public.challenge_cosmetics(code),earned_at timestamptz NOT NULL DEFAULT now(),source_id uuid NOT NULL,PRIMARY KEY(user_id,cosmetic_code),FOREIGN KEY(source_id,user_id) REFERENCES public.challenge_enrollments(id,user_id));
CREATE INDEX challenge_owned_cosmetic ON public.challenge_owned(cosmetic_code);
CREATE INDEX challenge_owned_source ON public.challenge_owned(source_id,user_id);
CREATE TABLE public.challenge_equipment(user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,badge text,frame text,accent text,version integer NOT NULL DEFAULT 0,FOREIGN KEY(user_id,badge) REFERENCES public.challenge_owned(user_id,cosmetic_code),FOREIGN KEY(user_id,frame) REFERENCES public.challenge_owned(user_id,cosmetic_code),FOREIGN KEY(user_id,accent) REFERENCES public.challenge_owned(user_id,cosmetic_code));
CREATE TABLE public.challenge_facts(user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,kind text NOT NULL,source_key text NOT NULL,subject text NOT NULL,happened_at timestamptz NOT NULL,PRIMARY KEY(user_id,kind,source_key));
CREATE INDEX challenge_facts_period ON public.challenge_facts(user_id,kind,happened_at,subject);
CREATE UNIQUE INDEX challenge_new_word_once ON public.challenge_facts(user_id,subject) WHERE kind='word_new';
CREATE TABLE public.challenge_sprints(id uuid PRIMARY KEY,user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,enrollment_id uuid NOT NULL UNIQUE,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,UNIQUE(id,user_id),FOREIGN KEY(enrollment_id,user_id) REFERENCES public.challenge_enrollments(id,user_id));
CREATE INDEX challenge_sprints_user ON public.challenge_sprints(user_id);
CREATE TABLE public.challenge_sprint_items(run_id uuid NOT NULL REFERENCES public.challenge_sprints(id) ON DELETE CASCADE,position integer NOT NULL CHECK(position BETWEEN 1 AND 5),topic_id uuid NOT NULL REFERENCES public.lessons(id),kind text NOT NULL,prompt text NOT NULL,payload jsonb NOT NULL,answer_key jsonb NOT NULL,explanation text NOT NULL,answer jsonb,correct boolean,request_id uuid,PRIMARY KEY(run_id,position),UNIQUE(run_id,request_id));
CREATE INDEX challenge_sprint_topic ON public.challenge_sprint_items(topic_id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['challenge_cosmetics','premium_challenge_templates','challenge_enrollments','challenge_owned','challenge_equipment','challenge_facts','challenge_sprints','challenge_sprint_items'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;
GRANT SELECT ON public.challenge_cosmetics,public.premium_challenge_templates,public.challenge_enrollments,public.challenge_owned,public.challenge_equipment TO authenticated;
CREATE POLICY challenge_cosmetic_catalog ON public.challenge_cosmetics FOR SELECT TO authenticated USING(true);
CREATE POLICY challenge_template_catalog ON public.premium_challenge_templates FOR SELECT TO authenticated USING(true);
CREATE POLICY challenge_enroll_owner ON public.challenge_enrollments FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY challenge_owned_owner ON public.challenge_owned FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY challenge_equipped_owner ON public.challenge_equipment FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

-- A private, append-only record of trusted completion events. No browser can submit progress.
CREATE FUNCTION public.challenge_capture() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE front text; grams integer; total integer; good integer;
BEGIN
 IF TG_TABLE_NAME='word_review_events' THEN
  SELECT lower(trim(w.front)) INTO front FROM public.word_reviews w WHERE w.user_id=NEW.user_id AND w.word_key=NEW.word_key;
  IF front IS NOT NULL AND front ~ '[a-z]' THEN
   INSERT INTO public.challenge_facts VALUES(NEW.user_id,'word_review',NEW.request_id::text,front,NEW.created_at) ON CONFLICT DO NOTHING;
   IF NEW.rating>=3 THEN INSERT INTO public.challenge_facts VALUES(NEW.user_id,'word_new',NEW.request_id::text,front,NEW.created_at) ON CONFLICT DO NOTHING; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='lesson_attempts' THEN
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.score>=60 AND EXISTS(SELECT 1 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE l.id=NEW.lesson_id AND l.published AND NOT l.retired_audio AND lang.code='en') THEN
   INSERT INTO public.challenge_facts VALUES(NEW.user_id,'lesson',NEW.id::text,NEW.lesson_id::text,NEW.completed_at) ON CONFLICT DO NOTHING;
  END IF;
 ELSIF TG_TABLE_NAME='weak_runs' THEN
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
   SELECT count(*),count(*) FILTER(WHERE public.learning_exercise_skill(i.kind)='grammar'),count(*) FILTER(WHERE a.correct) INTO total,grams,good FROM public.weak_items i JOIN public.weak_answers a ON a.run_id=i.run_id AND a.position=i.position WHERE i.run_id=NEW.id;
   IF total>=3 AND grams>=3 AND grams*2>=total AND good*100>=total*60 THEN INSERT INTO public.challenge_facts VALUES(NEW.user_id,'grammar',NEW.id::text,NEW.topic_id::text,NEW.completed_at) ON CONFLICT DO NOTHING; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='story_attempts' THEN
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' THEN INSERT INTO public.challenge_facts VALUES(NEW.user_id,'story',NEW.id::text,NEW.story_slug,NEW.completed_at) ON CONFLICT DO NOTHING; END IF;
 ELSIF TG_TABLE_NAME='challenge_sprints' THEN
  IF NEW.completed_at IS NOT NULL AND OLD.completed_at IS NULL THEN INSERT INTO public.challenge_facts VALUES(NEW.user_id,'sprint',NEW.id::text,NEW.id::text,NEW.completed_at) ON CONFLICT DO NOTHING; END IF;
 END IF;
 RETURN NEW;
END $$;
-- Backfill prevents old successful words being presented as newly learned after enrolment.
INSERT INTO public.challenge_facts SELECT e.user_id,'word_review',e.request_id::text,lower(trim(w.front)),e.created_at FROM public.word_review_events e JOIN public.word_reviews w ON w.user_id=e.user_id AND w.word_key=e.word_key WHERE w.front ~* '[a-z]' ON CONFLICT DO NOTHING;
INSERT INTO public.challenge_facts SELECT DISTINCT ON(user_id,subject) user_id,'word_new',source_key,subject,happened_at FROM public.challenge_facts f WHERE kind='word_review' AND EXISTS(SELECT 1 FROM public.word_review_events e WHERE e.user_id=f.user_id AND e.request_id::text=f.source_key AND e.rating>=3) ORDER BY user_id,subject,happened_at,source_key ON CONFLICT DO NOTHING;
INSERT INTO public.challenge_facts SELECT a.user_id,'lesson',a.id::text,a.lesson_id::text,a.completed_at FROM public.lesson_attempts a JOIN public.lessons l ON l.id=a.lesson_id JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE a.status='completed' AND a.score>=60 AND NOT l.retired_audio AND lang.code='en' ON CONFLICT DO NOTHING;
INSERT INTO public.challenge_facts SELECT a.user_id,'story',a.id::text,a.story_slug,a.completed_at FROM public.story_attempts a WHERE a.status='completed' ON CONFLICT DO NOTHING;
INSERT INTO public.challenge_facts SELECT r.user_id,'grammar',r.id::text,r.topic_id::text,r.completed_at FROM public.weak_runs r JOIN public.weak_items i ON i.run_id=r.id JOIN public.weak_answers a ON a.run_id=i.run_id AND a.position=i.position WHERE r.status='completed' GROUP BY r.id HAVING count(*)>=3 AND count(*) FILTER(WHERE public.learning_exercise_skill(i.kind)='grammar')>=3 AND count(*) FILTER(WHERE public.learning_exercise_skill(i.kind)='grammar')*2>=count(*) AND count(*) FILTER(WHERE a.correct)*100>=count(*)*60 ON CONFLICT DO NOTHING;
CREATE TRIGGER challenge_review AFTER INSERT ON public.word_review_events FOR EACH ROW EXECUTE FUNCTION public.challenge_capture();
CREATE TRIGGER challenge_lesson AFTER UPDATE OF status ON public.lesson_attempts FOR EACH ROW EXECUTE FUNCTION public.challenge_capture();
CREATE TRIGGER challenge_grammar AFTER UPDATE OF status ON public.weak_runs FOR EACH ROW EXECUTE FUNCTION public.challenge_capture();
CREATE TRIGGER challenge_story AFTER UPDATE OF status ON public.story_attempts FOR EACH ROW EXECUTE FUNCTION public.challenge_capture();
CREATE TRIGGER challenge_sprint AFTER UPDATE OF completed_at ON public.challenge_sprints FOR EACH ROW EXECUTE FUNCTION public.challenge_capture();

CREATE FUNCTION public.challenge_week() RETURNS date LANGUAGE sql STABLE SET search_path='' AS $$ SELECT date_trunc('week',now() AT TIME ZONE 'UTC')::date $$;
CREATE FUNCTION public.challenge_sync(p_user uuid) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE entry public.challenge_enrollments; amount integer; reached timestamptz;
BEGIN
 FOR entry IN SELECT * FROM public.challenge_enrollments WHERE user_id=p_user AND completed_at IS NULL LOOP
  WITH unique_events AS(SELECT subject,min(happened_at) AS at FROM public.challenge_facts WHERE user_id=p_user AND kind=entry.kind AND happened_at>=entry.starts_at AND happened_at<entry.ends_at GROUP BY subject)
  SELECT count(*),(SELECT at FROM unique_events ORDER BY at,subject LIMIT 1 OFFSET entry.target-1) INTO amount,reached FROM unique_events;
  UPDATE public.challenge_enrollments SET progress=least(entry.target,amount),completed_at=reached WHERE id=entry.id;
 END LOOP;
END $$;
CREATE FUNCTION public.challenge_showcase(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version',coalesce((SELECT version FROM public.challenge_equipment WHERE user_id=p_user),0),'equipped',coalesce((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.slot) FROM public.challenge_equipment e JOIN public.challenge_cosmetics c ON c.code IN(e.badge,e.frame,e.accent) WHERE e.user_id=p_user),'[]'))
$$;
CREATE FUNCTION public.challenge_dashboard(p_user uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE theme integer; result jsonb;
BEGIN
 PERFORM public.challenge_sync(p_user);
 theme:=mod((public.challenge_week()-date '2026-01-05')/7,3);
 SELECT jsonb_build_object('premium',public.has_feature(p_user,'extra_exercises'),'week',public.challenge_week(),'theme',(ARRAY['Слова вокруг нас','Чёткие мысли','Истории и общение'])[theme+1],'serverTime',now(),
 'templates',(SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('featured',CASE theme WHEN 0 THEN t.kind IN('word_new','word_review','sprint') WHEN 1 THEN t.kind IN('grammar','lesson','sprint') ELSE t.kind IN('story','lesson','word_review') END) ORDER BY t.code) FROM public.premium_challenge_templates t),
 'enrollments',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.starts_at DESC,r.id) FROM(SELECT * FROM public.challenge_enrollments WHERE user_id=p_user ORDER BY starts_at DESC,id LIMIT 60)r),'[]'),
 'cosmetics',(SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('owned',o.user_id IS NOT NULL,'earnedAt',o.earned_at) ORDER BY c.slot,c.code) FROM public.challenge_cosmetics c LEFT JOIN public.challenge_owned o ON o.cosmetic_code=c.code AND o.user_id=p_user),
 'showcase',public.challenge_showcase(p_user)) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.challenge_sprint_state(p_user uuid,p_run uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE s public.challenge_sprints; item public.challenge_sprint_items; done integer; good integer; access boolean;
BEGIN
 SELECT * INTO s FROM public.challenge_sprints WHERE id=p_run AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'challenge unavailable'; END IF;
 SELECT count(*) FILTER(WHERE answer IS NOT NULL),count(*) FILTER(WHERE correct) INTO done,good FROM public.challenge_sprint_items WHERE run_id=p_run;
 SELECT * INTO item FROM public.challenge_sprint_items WHERE run_id=p_run AND answer IS NULL ORDER BY position LIMIT 1;
 access:=public.has_feature(p_user,'extra_exercises') AND NOT EXISTS(SELECT 1 FROM public.challenge_sprint_items i WHERE i.run_id=p_run AND NOT public.can_access_lesson(p_user,i.topic_id));
 RETURN jsonb_build_object('id',s.id,'enrollmentId',s.enrollment_id,'startedAt',s.created_at,'completedAt',s.completed_at,'serverTime',now(),'elapsedSeconds',greatest(0,floor(extract(epoch FROM coalesce(s.completed_at,now())-s.created_at))),'answered',done,'correct',good,'total',5,'accessible',access,'exercise',CASE WHEN access AND item.position IS NOT NULL THEN jsonb_build_object('position',item.position,'kind',item.kind,'prompt',item.prompt,'payload',item.payload) END);
END $$;
CREATE FUNCTION public.challenge_command(p_user uuid,p_command jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE action text:=p_command->>'action'; entry public.challenge_enrollments; template public.premium_challenge_templates; existing public.challenge_enrollments; eq public.challenge_equipment; asset public.challenge_cosmetics; run public.challenge_sprints; item public.challenge_sprint_items; request uuid; pos integer; submitted jsonb; ok boolean; total integer; inserted integer; fresh boolean;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':challenges',0));
 IF action='equip' THEN
  SELECT * INTO eq FROM public.challenge_equipment WHERE user_id=p_user FOR UPDATE;
  IF p_command->>'slot' NOT IN('badge','frame','accent') OR NOT(p_command ? 'slot') THEN RAISE EXCEPTION 'invalid challenge cosmetic'; END IF;
  IF p_command->>'code' IS NOT NULL THEN
   SELECT c.* INTO asset FROM public.challenge_cosmetics c JOIN public.challenge_owned o ON o.cosmetic_code=c.code AND o.user_id=p_user WHERE c.code=p_command->>'code' AND c.slot=p_command->>'slot';
   IF NOT FOUND THEN RAISE EXCEPTION 'challenge unavailable'; END IF;
  END IF;
  IF coalesce(eq.version,0)<>(p_command->>'version')::integer THEN RAISE EXCEPTION 'challenge conflict'; END IF;
  INSERT INTO public.challenge_equipment(user_id,badge,frame,accent,version) VALUES(p_user,CASE WHEN p_command->>'slot'='badge' THEN p_command->>'code' ELSE eq.badge END,CASE WHEN p_command->>'slot'='frame' THEN p_command->>'code' ELSE eq.frame END,CASE WHEN p_command->>'slot'='accent' THEN p_command->>'code' ELSE eq.accent END,coalesce(eq.version,0)+1)
  ON CONFLICT(user_id) DO UPDATE SET badge=excluded.badge,frame=excluded.frame,accent=excluded.accent,version=excluded.version;
  RETURN public.challenge_dashboard(p_user);
 END IF;
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required'; END IF;
 IF action='enroll' THEN
  SELECT * INTO template FROM public.premium_challenge_templates WHERE code=p_command->>'code';
  IF NOT FOUND THEN RAISE EXCEPTION 'challenge unavailable'; END IF;
  request:=(p_command->>'requestId')::uuid;
  IF request IS NULL THEN RAISE EXCEPTION 'invalid challenge request'; END IF;
  SELECT * INTO existing FROM public.challenge_enrollments WHERE id=request;
  IF FOUND AND (existing.user_id<>p_user OR existing.code<>template.code) THEN RAISE EXCEPTION 'challenge conflict'; END IF;
  IF NOT FOUND THEN
   INSERT INTO public.challenge_enrollments(id,user_id,code,edition,title,kind,target,reward_code) VALUES(request,p_user,template.code,public.challenge_week(),template.title,template.kind,template.target,template.reward_code) ON CONFLICT(user_id,code,edition) DO NOTHING;
  END IF;
  RETURN public.challenge_dashboard(p_user);
 ELSIF action='claim' THEN
  PERFORM public.challenge_sync(p_user);
  SELECT * INTO entry FROM public.challenge_enrollments WHERE id=(p_command->>'enrollmentId')::uuid AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'challenge unavailable'; END IF;
  IF entry.completed_at IS NULL THEN RAISE EXCEPTION 'challenge incomplete'; END IF;
  fresh:=entry.claimed_at IS NULL;
  IF fresh THEN
   INSERT INTO public.challenge_owned(user_id,cosmetic_code,source_id) VALUES(p_user,entry.reward_code,entry.id) ON CONFLICT DO NOTHING;
   UPDATE public.challenge_enrollments SET claimed_at=now() WHERE id=entry.id;
  END IF;
  RETURN jsonb_build_object('awarded',fresh,'dashboard',public.challenge_dashboard(p_user));
 ELSIF action='sprint_start' THEN
  SELECT * INTO entry FROM public.challenge_enrollments WHERE id=(p_command->>'enrollmentId')::uuid AND user_id=p_user AND kind='sprint';
  IF NOT FOUND THEN RAISE EXCEPTION 'challenge unavailable'; END IF;
  SELECT * INTO run FROM public.challenge_sprints WHERE enrollment_id=entry.id AND user_id=p_user;
  IF FOUND THEN RETURN public.challenge_sprint_state(p_user,run.id); END IF;
  IF entry.ends_at<=now() THEN RAISE EXCEPTION 'challenge closed'; END IF;
  request:=(p_command->>'requestId')::uuid;
  INSERT INTO public.challenge_sprints(id,user_id,enrollment_id) VALUES(request,p_user,entry.id);
  INSERT INTO public.challenge_sprint_items(run_id,position,topic_id,kind,prompt,payload,answer_key,explanation)
   SELECT request,row_number() OVER(ORDER BY md5(m.exercise_id::text||request::text)),m.topic_id,m.kind,m.prompt,m.payload,m.answer_key,m.explanation FROM (SELECT * FROM public.weak_material(p_user) ORDER BY md5(exercise_id::text||request::text) LIMIT 5) m;
  IF (SELECT count(*) FROM public.challenge_sprint_items WHERE run_id=request)<>5 THEN RAISE EXCEPTION 'challenge materials unavailable'; END IF;
  RETURN public.challenge_sprint_state(p_user,request);
 ELSIF action='sprint_answer' THEN
  SELECT * INTO run FROM public.challenge_sprints WHERE id=(p_command->>'runId')::uuid AND user_id=p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'challenge unavailable'; END IF;
  IF EXISTS(SELECT 1 FROM public.challenge_sprint_items i WHERE i.run_id=run.id AND NOT public.can_access_lesson(p_user,i.topic_id)) THEN RAISE EXCEPTION 'challenge unavailable'; END IF;
  request:=(p_command->>'requestId')::uuid; pos:=(p_command->>'position')::integer; submitted:=p_command->'answer';
  IF request IS NULL OR submitted IS NULL OR octet_length(submitted::text)>4096 THEN RAISE EXCEPTION 'invalid challenge answer'; END IF;
  SELECT * INTO item FROM public.challenge_sprint_items WHERE run_id=run.id AND request_id=request;
  IF FOUND THEN
   IF item.position<>pos OR item.answer<>submitted THEN RAISE EXCEPTION 'challenge conflict'; END IF;
  ELSE
   SELECT * INTO item FROM public.challenge_sprint_items WHERE run_id=run.id AND answer IS NULL ORDER BY position LIMIT 1;
   IF run.completed_at IS NOT NULL OR item.position IS NULL OR item.position<>pos THEN RAISE EXCEPTION 'challenge conflict'; END IF;
   IF NOT coalesce(public.lesson_answer_valid(item.kind,item.payload,submitted),false) THEN RAISE EXCEPTION 'invalid challenge answer'; END IF;
   ok:=public.lesson_check_answer(item.kind,item.payload,item.answer_key,submitted);
   UPDATE public.challenge_sprint_items SET answer=submitted,correct=ok,request_id=request WHERE run_id=run.id AND position=pos;
   item.correct:=ok;
   IF NOT EXISTS(SELECT 1 FROM public.challenge_sprint_items WHERE run_id=run.id AND answer IS NULL) THEN UPDATE public.challenge_sprints SET completed_at=now() WHERE id=run.id; END IF;
  END IF;
  RETURN jsonb_build_object('correct',item.correct,'explanation',item.explanation,'state',public.challenge_sprint_state(p_user,run.id));
 END IF;
 RAISE EXCEPTION 'invalid challenge command';
END $$;
CREATE FUNCTION public.challenge_database_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','challenges-v1','ready',
 (SELECT count(*)=8 AND bool_and(relrowsecurity) FROM pg_class WHERE oid IN('public.challenge_cosmetics'::regclass,'public.premium_challenge_templates'::regclass,'public.challenge_enrollments'::regclass,'public.challenge_owned'::regclass,'public.challenge_equipment'::regclass,'public.challenge_facts'::regclass,'public.challenge_sprints'::regclass,'public.challenge_sprint_items'::regclass))
 AND NOT has_function_privilege('authenticated','public.challenge_command(uuid,jsonb)','EXECUTE') AND NOT has_function_privilege('anon','public.challenge_command(uuid,jsonb)','EXECUTE')
 AND NOT has_table_privilege('authenticated','public.challenge_sprint_items','SELECT') AND NOT has_table_privilege('authenticated','public.challenge_facts','INSERT')
 AND (SELECT count(*)=6 FROM public.premium_challenge_templates))
$$;
REVOKE ALL ON FUNCTION public.challenge_capture(),public.challenge_week(),public.challenge_sync(uuid),public.challenge_showcase(uuid),public.challenge_dashboard(uuid),public.challenge_sprint_state(uuid,uuid),public.challenge_command(uuid,jsonb),public.challenge_database_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.challenge_capture(),public.challenge_week(),public.challenge_sync(uuid),public.challenge_showcase(uuid),public.challenge_dashboard(uuid),public.challenge_sprint_state(uuid,uuid),public.challenge_command(uuid,jsonb),public.challenge_database_status() TO service_role;
COMMIT;
