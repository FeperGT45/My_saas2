BEGIN;
ALTER TABLE public.exercises DROP CONSTRAINT exercises_kind_check;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_kind_check CHECK(kind IN ('single_choice','sentence','gap','matching','grammar','listening'));
ALTER TABLE public.exercises ADD COLUMN public_payload jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(public_payload)='object');
ALTER TABLE public.exercises ADD COLUMN answer_key jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(answer_key)='object');
-- Legacy option-based exercises remain supported. New exercises are validated at attempt creation.
CREATE OR REPLACE FUNCTION public.check_exercise_options() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE target uuid; targets uuid[];
BEGIN
 IF TG_TABLE_NAME='exercises' THEN targets:=ARRAY[NEW.id];
 ELSIF TG_OP='INSERT' THEN targets:=ARRAY[NEW.exercise_id];
 ELSIF TG_OP='DELETE' THEN targets:=ARRAY[OLD.exercise_id]; ELSE targets:=ARRAY[NEW.exercise_id,OLD.exercise_id]; END IF;
 FOR target IN SELECT DISTINCT x FROM unnest(targets) x WHERE x IS NOT NULL LOOP
  IF EXISTS(SELECT 1 FROM public.exercises WHERE id=target AND kind='single_choice' AND public_payload='{}') AND
   ((SELECT count(*) FROM public.exercise_options WHERE exercise_id=target)<2 OR (SELECT count(*) FROM public.exercise_options WHERE exercise_id=target AND is_correct)<>1) THEN
    RAISE EXCEPTION 'single_choice needs two options and exactly one answer' USING ERRCODE='23514';
  END IF;
 END LOOP; RETURN NULL;
END $$;
ALTER TABLE public.lesson_attempts ADD COLUMN xp_reward_snapshot integer CHECK(xp_reward_snapshot BETWEEN 0 AND 1000);
CREATE TABLE public.lesson_attempt_items (
 attempt_id uuid NOT NULL REFERENCES public.lesson_attempts(id) ON DELETE CASCADE,
 position integer NOT NULL CHECK(position>0), exercise_id uuid NOT NULL,
 kind text NOT NULL, prompt text NOT NULL, payload jsonb NOT NULL, answer_key jsonb NOT NULL, explanation text NOT NULL,
 PRIMARY KEY(attempt_id,position), UNIQUE(attempt_id,exercise_id)
);
CREATE TABLE public.exercise_submissions (
 attempt_id uuid NOT NULL, position integer NOT NULL, answer jsonb NOT NULL,
 correct boolean NOT NULL, feedback text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(attempt_id,position), FOREIGN KEY(attempt_id,position) REFERENCES public.lesson_attempt_items(attempt_id,position) ON DELETE CASCADE
);
ALTER TABLE public.lesson_attempt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exercise_submissions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lesson_attempt_items,public.exercise_submissions FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.lesson_attempt_items,public.exercise_submissions TO service_role;
-- Explicit public DTOs: never SELECT * on an exercise or a snapshot for a browser.
CREATE FUNCTION public.lesson_public_payload(k text,p jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result jsonb:='{}'; field text; items jsonb;
BEGIN
 FOREACH field IN ARRAY CASE WHEN k='sentence' THEN ARRAY['tokens'] WHEN k='matching' THEN ARRAY['left','right'] WHEN k IN ('single_choice','grammar','listening') THEN ARRAY['options'] ELSE ARRAY[]::text[] END LOOP
  SELECT jsonb_agg(jsonb_build_object('id',x->>'id','label',x->>'label')) INTO items FROM jsonb_array_elements(p->field) x;
  IF items IS NULL OR jsonb_array_length(items) NOT BETWEEN 2 AND 30 OR EXISTS(SELECT 1 FROM jsonb_array_elements(items) x WHERE coalesce(x->>'id','')='' OR coalesce(x->>'label','')='') OR (SELECT count(DISTINCT x->>'id') FROM jsonb_array_elements(items) x)<>jsonb_array_length(items) THEN RAISE EXCEPTION 'invalid exercise content'; END IF;
  result:=result||jsonb_build_object(field,items);
 END LOOP;
 IF k='gap' THEN
  IF coalesce(p->>'sentence','')='' THEN RAISE EXCEPTION 'invalid gap'; END IF;
  result:=jsonb_build_object('sentence',p->>'sentence');
 END IF;
 IF k='listening' THEN
  IF coalesce(p->>'text','')='' OR length(p->>'text')>500 THEN RAISE EXCEPTION 'invalid audio'; END IF;
  result:=result||jsonb_build_object('text',p->>'text','lang',coalesce(p->>'lang','en-US'));
 END IF;
 RETURN result;
END $$;
CREATE FUNCTION public.lesson_key_valid(k text,p jsonb,a jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF k IN ('single_choice','grammar','listening') THEN
  IF jsonb_typeof(a->'value') IS DISTINCT FROM 'string' THEN RETURN false; END IF;
  RETURN jsonb_typeof(a->'value')='string' AND EXISTS(SELECT 1 FROM jsonb_array_elements(p->'options') x WHERE x->'id'=a->'value');
 ELSIF k='sentence' THEN
  IF jsonb_typeof(a->'value') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  RETURN jsonb_typeof(a->'value')='array' AND jsonb_array_length(a->'value')>0 AND
   (SELECT count(DISTINCT x) FROM jsonb_array_elements(a->'value') x)=jsonb_array_length(a->'value') AND
   NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'value') x WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'tokens') t WHERE t->'id'=x));
 ELSIF k='gap' THEN
  IF jsonb_typeof(a->'accepted') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  RETURN jsonb_typeof(a->'accepted')='array' AND jsonb_array_length(a->'accepted')>0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a->'accepted') x WHERE jsonb_typeof(x)<>'string' OR length(trim(x#>>'{}'))=0);
 ELSIF k='matching' THEN
  IF jsonb_typeof(a->'pairs') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  RETURN jsonb_typeof(a->'pairs')='object' AND (SELECT count(*) FROM jsonb_each(a->'pairs'))=jsonb_array_length(p->'left') AND jsonb_array_length(p->'left')=jsonb_array_length(p->'right') AND
   NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'left') x WHERE NOT (a->'pairs' ? (x->>'id'))) AND
   (SELECT count(DISTINCT value) FROM jsonb_each_text(a->'pairs'))=jsonb_array_length(p->'right') AND
   NOT EXISTS(SELECT 1 FROM jsonb_each_text(a->'pairs') pair WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p->'right') x WHERE x->>'id'=pair.value));
 END IF; RETURN false;
END $$;
CREATE FUNCTION public.lesson_grade(k text,key jsonb,answer jsonb) RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
BEGIN
 IF k='gap' THEN RETURN jsonb_typeof(answer)='string' AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(key->'accepted') x WHERE lower(trim(regexp_replace(x,'\s+',' ','g')))=lower(trim(regexp_replace(answer#>>'{}','\s+',' ','g'))));
 ELSIF k='matching' THEN RETURN answer=key->'pairs';
 ELSE RETURN answer=key->'value'; END IF;
END $$;
CREATE FUNCTION public.lesson_state(p_user uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.lesson_attempts; item public.lesson_attempt_items; total integer; answered integer; correct_count integer; xp integer;
BEGIN
 SELECT * INTO a FROM public.lesson_attempts WHERE id=p_attempt AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'attempt unavailable'; END IF;
 IF a.status='abandoned' THEN RAISE EXCEPTION 'attempt closed'; END IF;
 SELECT count(*) INTO total FROM public.lesson_attempt_items WHERE attempt_id=a.id;
 SELECT count(*),count(*) FILTER(WHERE correct) INTO answered,correct_count FROM public.exercise_submissions WHERE attempt_id=a.id;
 SELECT * INTO item FROM public.lesson_attempt_items i WHERE i.attempt_id=a.id AND NOT EXISTS(SELECT 1 FROM public.exercise_submissions s WHERE s.attempt_id=i.attempt_id AND s.position=i.position) ORDER BY i.position LIMIT 1;
 SELECT coalesce(sum(amount),0) INTO xp FROM public.xp_events WHERE attempt_id=a.id;
 RETURN jsonb_build_object('attemptId',a.id,'lessonId',a.lesson_id,'status',a.status,'total',total,'answered',answered,'correct',correct_count,'score',a.score,'xp',xp,
  'exercise',CASE WHEN item.position IS NULL THEN NULL ELSE jsonb_build_object('position',item.position,'kind',item.kind,'prompt',item.prompt,'payload',item.payload) END);
END $$;
CREATE FUNCTION public.start_lesson(p_user uuid,p_lesson uuid,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE e public.exercises; payload jsonb; key jsonb; n integer:=0;
BEGIN
 -- Serialize per-user starts and make retries of the same request idempotent.
 PERFORM 1 FROM public.users WHERE id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'user unavailable'; END IF;
 IF EXISTS(SELECT 1 FROM public.lesson_attempts WHERE id=p_request) THEN
  IF NOT EXISTS(SELECT 1 FROM public.lesson_attempts WHERE id=p_request AND user_id=p_user AND lesson_id=p_lesson) THEN RAISE EXCEPTION 'attempt unavailable'; END IF;
  RETURN public.lesson_state(p_user,p_request);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id WHERE l.id=p_lesson AND l.published AND c.published AND lang.active) THEN RAISE EXCEPTION 'lesson unavailable'; END IF;
 UPDATE public.lesson_attempts SET status='abandoned' WHERE user_id=p_user AND status='started' AND started_at<now()-interval '24 hours';
 IF (SELECT count(*) FROM public.lesson_attempts WHERE user_id=p_user AND status='started')>=10 THEN RAISE EXCEPTION 'too many active attempts'; END IF;
 INSERT INTO public.lesson_attempts(id,user_id,lesson_id,xp_reward_snapshot) VALUES(p_request,p_user,p_lesson,(SELECT xp_reward FROM public.lessons WHERE id=p_lesson));
 FOR e IN SELECT * FROM public.exercises WHERE lesson_id=p_lesson ORDER BY position LIMIT 101 LOOP
  n:=n+1;
  IF n>100 THEN RAISE EXCEPTION 'lesson too large'; END IF;
  payload:=e.public_payload; key:=e.answer_key;
  IF e.kind='single_choice' AND payload='{}' THEN
   SELECT jsonb_build_object('options',jsonb_agg(jsonb_build_object('id',id::text,'label',label) ORDER BY position)),jsonb_build_object('value',max(id::text) FILTER(WHERE is_correct)) INTO payload,key FROM public.exercise_options WHERE exercise_id=e.id;
  END IF;
  payload:=public.lesson_public_payload(e.kind,payload);
  IF NOT coalesce(public.lesson_key_valid(e.kind,payload,key),false) THEN RAISE EXCEPTION 'invalid exercise key'; END IF;
  INSERT INTO public.lesson_attempt_items VALUES(p_request,n,e.id,e.kind,e.prompt,payload,key,e.explanation);
 END LOOP;
 IF n=0 THEN RAISE EXCEPTION 'lesson is empty'; END IF;
 RETURN public.lesson_state(p_user,p_request);
END $$;
CREATE FUNCTION public.submit_lesson_answer(p_user uuid,p_attempt uuid,p_position integer,p_answer jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.lesson_attempts; item public.lesson_attempt_items; previous public.exercise_submissions; ok boolean; feedback text; total integer; done integer;
BEGIN
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
CREATE OR REPLACE FUNCTION public.award_completed_lesson(p_attempt_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE a public.lesson_attempts; reward integer; inserted integer;
BEGIN
 SELECT * INTO a FROM public.lesson_attempts WHERE id=p_attempt_id FOR UPDATE;
 IF NOT FOUND OR a.status<>'completed' THEN RAISE EXCEPTION 'completed attempt required'; END IF;
 SELECT coalesce(a.xp_reward_snapshot,xp_reward) INTO STRICT reward FROM public.lessons WHERE id=a.lesson_id;
 INSERT INTO public.xp_events(user_id,lesson_id,attempt_id,amount) VALUES(a.user_id,a.lesson_id,a.id,reward) ON CONFLICT(user_id,lesson_id) DO NOTHING;
 GET DIAGNOSTICS inserted = ROW_COUNT;
 INSERT INTO public.user_progress(user_id,lesson_id,best_score,completed_at) VALUES(a.user_id,a.lesson_id,a.score,a.completed_at)
 ON CONFLICT(user_id,lesson_id) DO UPDATE SET best_score=greatest(public.user_progress.best_score,excluded.best_score);
 INSERT INTO public.daily_streaks(user_id,activity_date) VALUES(a.user_id,(a.completed_at AT TIME ZONE 'UTC')::date) ON CONFLICT DO NOTHING;
 RETURN inserted=1;
END $$;

-- No RPC may be called by a browser or a self-asserted user id.
REVOKE ALL ON FUNCTION public.lesson_public_payload(text,jsonb),public.lesson_key_valid(text,jsonb,jsonb),public.lesson_grade(text,jsonb,jsonb),public.lesson_state(uuid,uuid),public.start_lesson(uuid,uuid,uuid),public.submit_lesson_answer(uuid,uuid,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lesson_state(uuid,uuid),public.start_lesson(uuid,uuid,uuid),public.submit_lesson_answer(uuid,uuid,integer,jsonb) TO service_role;
COMMIT;
