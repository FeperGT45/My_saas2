BEGIN;
CREATE INDEX dictionary_completed_lessons_idx ON public.lesson_attempts(user_id,lesson_id) WHERE status='completed';
CREATE TABLE public.dictionary_collections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 title text NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 80),version integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(id,user_id)
);
CREATE INDEX dictionary_collections_user_idx ON public.dictionary_collections(user_id);
CREATE TABLE public.dictionary_words (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 word_key text NOT NULL,front text NOT NULL CHECK(length(trim(front)) BETWEEN 1 AND 200 AND front ~ '[A-Za-z]'),
 back text NOT NULL CHECK(length(trim(back)) BETWEEN 1 AND 200),example text NOT NULL DEFAULT '' CHECK(length(example)<=2000),
 collection_id uuid,source_lesson_id uuid REFERENCES public.lessons(id) ON DELETE SET NULL,version integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),
 search_document tsvector GENERATED ALWAYS AS(to_tsvector('simple'::regconfig,front||' '||back||' '||example)) STORED,
 UNIQUE(user_id,word_key),FOREIGN KEY(collection_id,user_id) REFERENCES public.dictionary_collections(id,user_id),
 FOREIGN KEY(user_id,word_key) REFERENCES public.word_reviews(user_id,word_key)
);
CREATE INDEX dictionary_words_collection_idx ON public.dictionary_words(collection_id,user_id);
CREATE INDEX dictionary_words_source_idx ON public.dictionary_words(source_lesson_id);
CREATE INDEX dictionary_words_search_idx ON public.dictionary_words USING gin(search_document);
CREATE TABLE public.dictionary_operations (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,request_id uuid NOT NULL,action text NOT NULL,digest text NOT NULL,result jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,request_id)
);
ALTER TABLE public.dictionary_collections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dictionary_words ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dictionary_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.dictionary_collections,public.dictionary_words,public.dictionary_operations FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.dictionary_collections,public.dictionary_words,public.dictionary_operations TO service_role;
GRANT SELECT ON public.dictionary_collections TO authenticated;
GRANT SELECT(id,user_id,word_key,front,back,example,collection_id,source_lesson_id,version,created_at) ON public.dictionary_words TO authenticated;
CREATE POLICY dictionary_collections_owner ON public.dictionary_collections FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY dictionary_words_owner ON public.dictionary_words FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

CREATE FUNCTION public.dictionary_learned(p_user uuid) RETURNS TABLE(key text,front text,back text,example text,lesson_id uuid)
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT DISTINCT ON(md5(lower(trim(v->>'en'))||chr(31)||lower(trim(v->>'ru'))))
 md5(lower(trim(v->>'en'))||chr(31)||lower(trim(v->>'ru'))),trim(v->>'en'),trim(v->>'ru'),left(coalesce(v->>'example',''),2000),l.id
 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id JOIN public.courses c ON c.id=u.course_id JOIN public.languages lang ON lang.id=c.language_id
 CROSS JOIN LATERAL jsonb_array_elements(coalesce(l.lexicon,'[]'::jsonb)) v
 WHERE lang.code='en' AND (EXISTS(SELECT 1 FROM public.user_progress p WHERE p.user_id=p_user AND p.lesson_id=l.id AND p.best_score>=60)
 OR EXISTS(SELECT 1 FROM public.lesson_attempts a WHERE a.user_id=p_user AND a.lesson_id=l.id AND a.status='completed'))
 AND length(trim(v->>'en')) BETWEEN 1 AND 200 AND length(trim(v->>'ru')) BETWEEN 1 AND 200
 ORDER BY md5(lower(trim(v->>'en'))||chr(31)||lower(trim(v->>'ru'))),l.id
$$;
CREATE FUNCTION public.dictionary_search(p_search text) RETURNS tsquery LANGUAGE sql IMMUTABLE SET search_path='' AS $$
 SELECT to_tsquery('simple',string_agg(quote_literal(token)||':*',' & ')) FROM regexp_split_to_table(lower(trim(p_search)),'[^[:alnum:]]+') token WHERE token<>''
$$;
CREATE FUNCTION public.dictionary_read(p_user uuid,p_source text DEFAULT 'own',p_collection uuid DEFAULT NULL,p_search text DEFAULT '',p_offset integer DEFAULT 0) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result jsonb;q tsquery;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.users WHERE id=p_user) THEN RAISE EXCEPTION 'dictionary unavailable'; END IF;
 IF p_source IS NULL OR p_source NOT IN('own','lessons') OR p_search IS NULL OR length(p_search)>200 OR p_offset IS NULL OR p_offset<0 OR p_offset>100000 THEN RAISE EXCEPTION 'dictionary invalid query'; END IF;
 IF p_collection IS NOT NULL AND (p_source<>'own' OR NOT EXISTS(SELECT 1 FROM public.dictionary_collections WHERE user_id=p_user AND id=p_collection)) THEN RAISE EXCEPTION 'dictionary unavailable collection'; END IF;
 q:=public.dictionary_search(p_search);
 WITH matches AS MATERIALIZED (
 SELECT w.id,w.word_key AS key,w.front,w.back,w.example,w.collection_id AS "collectionId",w.version,r.due_at AS "dueAt",false AS imported
 FROM public.dictionary_words w JOIN public.word_reviews r ON r.user_id=w.user_id AND r.word_key=w.word_key
 WHERE p_source='own' AND w.user_id=p_user AND (p_collection IS NULL OR w.collection_id=p_collection) AND (p_search='' OR w.search_document@@q)
 UNION ALL
 SELECT NULL::uuid,l.key,l.front,l.back,l.example,NULL::uuid,0,NULL::timestamptz,EXISTS(SELECT 1 FROM public.dictionary_words w WHERE w.user_id=p_user AND w.word_key=l.key)
 FROM public.dictionary_learned(p_user) l WHERE p_source='lessons' AND (p_search='' OR to_tsvector('simple',l.front||' '||l.back||' '||l.example)@@q)
 ), stats AS (
 SELECT count(*) AS total,count(*) FILTER(WHERE r.due_at<=now()) AS due,count(*) FILTER(WHERE r.last_review IS NOT NULL) AS reviewed,
 count(*) FILTER(WHERE r.repetitions>=3) AS established,coalesce(sum(r.successes),0) AS known,coalesce(sum(r.errors),0) AS repeats
 FROM public.dictionary_words w JOIN public.word_reviews r ON r.user_id=w.user_id AND r.word_key=w.word_key WHERE w.user_id=p_user
 ), collection_counts AS(SELECT collection_id,count(*) AS words FROM public.dictionary_words WHERE user_id=p_user GROUP BY collection_id)
 SELECT jsonb_build_object('version','dictionary-v1','source',p_source,'offset',p_offset,'total',(SELECT count(*) FROM matches),
 'canManage',public.has_feature(p_user,'extra_exercises'),'canTrain',public.has_feature(p_user,'extra_exercises'),
 'words',coalesce((SELECT jsonb_agg(to_jsonb(w) ORDER BY lower(w.front),w.key) FROM (SELECT * FROM matches ORDER BY lower(front),key LIMIT 30 OFFSET p_offset) w),'[]'),
 'collections',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'version',c.version,'words',coalesce(n.words,0)) ORDER BY c.created_at,c.id) FROM public.dictionary_collections c LEFT JOIN collection_counts n ON n.collection_id=c.id WHERE c.user_id=p_user),'[]'),
 'statistics',CASE WHEN public.has_feature(p_user,'advanced_statistics') THEN (SELECT to_jsonb(stats) FROM stats) ELSE NULL END) INTO result;
 RETURN result;
END $$;
CREATE FUNCTION public.dictionary_cleanup_review(p_user uuid,p_key text) RETURNS void LANGUAGE sql SET search_path='' AS $$
 DELETE FROM public.word_reviews r WHERE r.user_id=p_user AND r.word_key=p_key AND NOT EXISTS(SELECT 1 FROM public.dictionary_words w WHERE w.user_id=p_user AND w.word_key=p_key) AND NOT EXISTS(SELECT 1 FROM public.dictionary_learned(p_user) l WHERE l.key=p_key)
$$;
CREATE FUNCTION public.dictionary_mutate(p_user uuid,p_request uuid,p_action text,p_data jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
<<payload>>
DECLARE prior public.dictionary_operations;w public.dictionary_words;c public.dictionary_collections;id uuid;collection uuid;k text;old_key text;front text;back text;example text;result jsonb;source uuid;
BEGIN
 IF p_request IS NULL OR p_action IS NULL OR p_action NOT IN('save_word','delete_word','save_collection','delete_collection','import') OR jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'dictionary invalid command'; END IF;
 -- Same lock order as basic SM-2: advisory lock before user/FK/card locks.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,91));
 PERFORM 1 FROM public.users WHERE public.users.id=p_user FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'dictionary unavailable'; END IF;
 IF p_action NOT IN('delete_word','delete_collection') AND NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required'; END IF;
 SELECT * INTO prior FROM public.dictionary_operations WHERE user_id=p_user AND request_id=p_request;
 IF FOUND THEN IF prior.action<>p_action OR prior.digest<>md5(p_data::text) THEN RAISE EXCEPTION 'dictionary conflict'; END IF;RETURN prior.result;END IF;
 collection:=(p_data->>'collectionId')::uuid;
 IF collection IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.dictionary_collections WHERE user_id=p_user AND dictionary_collections.id=collection) THEN RAISE EXCEPTION 'dictionary unavailable collection';END IF;
 IF p_action='save_collection' THEN
  id:=(p_data->>'id')::uuid;
  IF length(trim(coalesce(p_data->>'title',''))) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'dictionary invalid title'; END IF;
  IF id IS NULL THEN
   IF (SELECT count(*) FROM public.dictionary_collections WHERE user_id=p_user)>=1000 THEN RAISE EXCEPTION 'dictionary limit';END IF;
   INSERT INTO public.dictionary_collections(user_id,title) VALUES(p_user,trim(p_data->>'title')) RETURNING * INTO c;
  ELSE
   UPDATE public.dictionary_collections d SET title=trim(p_data->>'title'),version=d.version+1 WHERE d.id=payload.id AND d.user_id=p_user AND d.version=(p_data->>'version')::integer RETURNING d.* INTO c;
   IF NOT FOUND THEN RAISE EXCEPTION 'dictionary conflict'; END IF;
  END IF;
  result:=jsonb_build_object('id',c.id);
 ELSIF p_action='delete_collection' THEN
  SELECT * INTO c FROM public.dictionary_collections WHERE dictionary_collections.id=(p_data->>'id')::uuid AND user_id=p_user AND version=(p_data->>'version')::integer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dictionary conflict';END IF;
  UPDATE public.dictionary_words SET collection_id=NULL,version=version+1 WHERE user_id=p_user AND collection_id=c.id;
  DELETE FROM public.dictionary_collections WHERE dictionary_collections.id=c.id AND user_id=p_user;result:='{}';
 ELSIF p_action='delete_word' THEN
  SELECT * INTO w FROM public.dictionary_words WHERE dictionary_words.id=(p_data->>'id')::uuid AND user_id=p_user AND version=(p_data->>'version')::integer FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'dictionary conflict';END IF;
  DELETE FROM public.dictionary_words WHERE dictionary_words.id=w.id AND user_id=p_user;PERFORM public.dictionary_cleanup_review(p_user,w.word_key);result:='{}';
 ELSE
  IF p_action='import' THEN
   SELECT l.front,l.back,l.example,l.lesson_id INTO front,back,example,source FROM public.dictionary_learned(p_user) l WHERE l.key=p_data->>'key';
   IF NOT FOUND THEN RAISE EXCEPTION 'dictionary unavailable word';END IF;id:=NULL;
  ELSE front:=trim(p_data->>'front');back:=trim(p_data->>'back');example:=coalesce(p_data->>'example','');id:=(p_data->>'id')::uuid;END IF;
  IF front IS NULL OR back IS NULL OR length(front) NOT BETWEEN 1 AND 200 OR front !~ '[A-Za-z]' OR length(back) NOT BETWEEN 1 AND 200 OR length(example)>2000 THEN RAISE EXCEPTION 'dictionary invalid word';END IF;
  k:=md5(lower(trim(front))||chr(31)||lower(trim(back)));
  IF id IS NOT NULL THEN
   SELECT * INTO w FROM public.dictionary_words d WHERE d.id=payload.id AND d.user_id=p_user AND d.version=(p_data->>'version')::integer FOR UPDATE;
   IF NOT FOUND THEN RAISE EXCEPTION 'dictionary conflict';END IF;old_key:=w.word_key;
  ELSIF EXISTS(SELECT 1 FROM public.dictionary_words d WHERE d.user_id=p_user AND d.word_key=k) THEN
   SELECT d.id INTO id FROM public.dictionary_words d WHERE d.user_id=p_user AND d.word_key=k;
   result:=jsonb_build_object('id',id,'alreadyExists',true);
  ELSIF (SELECT count(*) FROM public.dictionary_words WHERE user_id=p_user)>=50000 THEN RAISE EXCEPTION 'dictionary limit';END IF;
  IF result IS NULL THEN
   INSERT INTO public.word_reviews(user_id,word_key,front,back) VALUES(p_user,k,front,back) ON CONFLICT DO NOTHING;
   IF id IS NULL THEN INSERT INTO public.dictionary_words(user_id,word_key,front,back,example,collection_id,source_lesson_id) VALUES(p_user,k,front,back,example,collection,source) RETURNING public.dictionary_words.id INTO id;
   ELSE
    UPDATE public.dictionary_words d SET word_key=k,front=payload.front,back=payload.back,example=payload.example,collection_id=collection,source_lesson_id=NULL,version=d.version+1 WHERE d.id=payload.id AND d.user_id=p_user;
    UPDATE public.word_reviews SET front=payload.front,back=payload.back,version=version+1 WHERE user_id=p_user AND word_key=k;
    IF old_key<>k THEN PERFORM public.dictionary_cleanup_review(p_user,old_key);END IF;
   END IF;
   result:=jsonb_build_object('id',id);
  END IF;
 END IF;
 INSERT INTO public.dictionary_operations VALUES(p_user,p_request,p_action,md5(p_data::text),result,now());RETURN result;
END $$;
CREATE FUNCTION public.dictionary_train(p_user uuid,p_collection uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
BEGIN
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required';END IF;
 IF p_collection IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.dictionary_collections WHERE user_id=p_user AND id=p_collection) THEN RAISE EXCEPTION 'dictionary unavailable collection';END IF;
 RETURN jsonb_build_object('cards',coalesce((SELECT jsonb_agg(to_jsonb(card)) FROM (SELECT w.id,r.word_key AS key,r.front,r.back,w.example,r.version FROM public.dictionary_words w JOIN public.word_reviews r ON r.user_id=w.user_id AND r.word_key=w.word_key WHERE w.user_id=p_user AND r.due_at<=now() AND (p_collection IS NULL OR w.collection_id=p_collection) ORDER BY r.due_at,w.id LIMIT 20) card),'[]'),
 'nextDue',(SELECT min(r.due_at) FROM public.dictionary_words w JOIN public.word_reviews r ON r.user_id=w.user_id AND r.word_key=w.word_key WHERE w.user_id=p_user AND r.due_at>now() AND (p_collection IS NULL OR w.collection_id=p_collection)));
END $$;
CREATE FUNCTION public.dictionary_answer(p_user uuid,p_id uuid,p_request uuid,p_key text,p_version integer,p_rating integer) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NOT public.has_feature(p_user,'extra_exercises') THEN RAISE EXCEPTION 'premium required';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text,91));
 IF NOT EXISTS(SELECT 1 FROM public.dictionary_words WHERE user_id=p_user AND id=p_id AND word_key=p_key) OR p_rating NOT IN(0,4) THEN RAISE EXCEPTION 'dictionary unavailable card'; END IF;
 RETURN public.word_review_answer(p_user,p_request,p_key,p_version,p_rating);
END $$;
CREATE OR REPLACE FUNCTION public.word_review_queue(p_user uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
 INSERT INTO public.word_reviews(user_id,word_key,front,back) SELECT p_user,l.key,l.front,l.back FROM public.dictionary_learned(p_user) l ON CONFLICT DO NOTHING;
 SELECT jsonb_build_object('total',count(*),'due',count(*) FILTER(WHERE due_at<=now()),'cards',coalesce((SELECT jsonb_agg(to_jsonb(c)) FROM (SELECT word_key AS key,front,back,version FROM public.word_reviews WHERE user_id=p_user AND due_at<=now() ORDER BY due_at,word_key LIMIT 20)c),'[]'::jsonb),'nextDue',min(due_at) FILTER(WHERE due_at>now())) INTO result FROM public.word_reviews WHERE user_id=p_user;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.dictionary_learned(uuid),public.dictionary_search(text),public.dictionary_read(uuid,text,uuid,text,integer),public.dictionary_cleanup_review(uuid,text),public.dictionary_mutate(uuid,uuid,text,jsonb),public.dictionary_train(uuid,uuid),public.dictionary_answer(uuid,uuid,uuid,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dictionary_learned(uuid),public.dictionary_search(text),public.dictionary_read(uuid,text,uuid,text,integer),public.dictionary_cleanup_review(uuid,text),public.dictionary_mutate(uuid,uuid,text,jsonb),public.dictionary_train(uuid,uuid),public.dictionary_answer(uuid,uuid,uuid,text,integer,integer) TO service_role;
-- Remove audio lessons from the live catalog while preserving attempts, XP and word sources.
ALTER TABLE public.lessons ADD COLUMN retired_audio boolean NOT NULL DEFAULT false;
CREATE FUNCTION public.audio_retirement_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN IF NEW.retired_audio OR (TG_OP='UPDATE' AND OLD.retired_audio) THEN NEW.retired_audio:=true;NEW.published:=false;END IF;RETURN NEW;END $$;
CREATE TRIGGER audio_retirement_guard BEFORE INSERT OR UPDATE ON public.lessons FOR EACH ROW EXECUTE FUNCTION public.audio_retirement_guard();
GRANT EXECUTE ON FUNCTION public.curriculum_inventory(text) TO service_role;
CREATE FUNCTION public.retire_audio_lessons() RETURNS integer LANGUAGE plpgsql SET search_path='' AS $$
DECLARE removed integer;
BEGIN
 UPDATE public.lessons l SET retired_audio=true,published=false WHERE NOT l.retired_audio AND
 (l.skills @> ARRAY['listening']::text[] OR l.title ILIKE '%аудир%' OR EXISTS(SELECT 1 FROM public.exercises e WHERE e.lesson_id=l.id AND e.kind IN('listening','dictation')));
 GET DIAGNOSTICS removed=ROW_COUNT;
 UPDATE public.curriculum_packages SET inventory=public.curriculum_inventory(id);
 RETURN removed;
END $$;
CREATE FUNCTION public.retire_packaged_audio() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.kind IN('listening','dictation') THEN UPDATE public.lessons SET retired_audio=true,published=false WHERE id=NEW.lesson_id AND content_package_id IS NOT NULL;END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER retire_packaged_audio AFTER INSERT OR UPDATE OF kind ON public.exercises FOR EACH ROW EXECUTE FUNCTION public.retire_packaged_audio();
SELECT public.retire_audio_lessons();
-- A live calendar cannot retain pending links to retired content. Completed history stays intact.
DELETE FROM public.weekly_plan_tasks t USING public.lessons l WHERE t.lesson_id=l.id AND l.retired_audio AND t.completed_at IS NULL;
UPDATE public.weekly_plans SET context_token=NULL,revision=revision+1;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('public.curriculum_library()'::regprocedure);
 IF position('FROM public.lesson_prerequisites WHERE lesson_id=l.id' IN definition)=0 THEN RAISE EXCEPTION 'unexpected library prerequisite query';END IF;
 definition:=replace(definition,'FROM public.lesson_prerequisites WHERE lesson_id=l.id','FROM public.lesson_prerequisites pr JOIN public.lessons predecessor ON predecessor.id=pr.prerequisite_id WHERE pr.lesson_id=l.id AND predecessor.published');
 EXECUTE replace(definition,E'\n ) c\n',E'\n ) c WHERE jsonb_array_length(c.lessons)>0\n');
END $$;
ALTER FUNCTION public.lesson_state(uuid,uuid) RENAME TO lesson_state_before_audio_retirement;
CREATE FUNCTION public.lesson_state(p_user uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM public.lesson_attempts a JOIN public.lessons l ON l.id=a.lesson_id WHERE a.id=p_attempt AND a.user_id=p_user AND a.status='started' AND l.retired_audio) THEN RAISE EXCEPTION 'audio lesson unavailable';END IF;
 RETURN public.lesson_state_before_audio_retirement(p_user,p_attempt);
END $$;
REVOKE ALL ON FUNCTION public.audio_retirement_guard(),public.retire_audio_lessons(),public.retire_packaged_audio(),public.lesson_state_before_audio_retirement(uuid,uuid),public.lesson_state(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.retire_audio_lessons(),public.lesson_state_before_audio_retirement(uuid,uuid),public.lesson_state(uuid,uuid) TO service_role;
CREATE FUNCTION public.dictionary_database_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','dictionary-v1','ready',
 (SELECT count(*)=3 AND bool_and(relrowsecurity) FROM pg_catalog.pg_class WHERE oid IN('public.dictionary_words'::regclass,'public.dictionary_collections'::regclass,'public.dictionary_operations'::regclass))
 AND NOT has_function_privilege('anon','public.dictionary_mutate(uuid,uuid,text,jsonb)','EXECUTE')
 AND NOT has_function_privilege('authenticated','public.dictionary_mutate(uuid,uuid,text,jsonb)','EXECUTE')
 AND NOT has_table_privilege('authenticated','public.dictionary_words','INSERT,UPDATE,DELETE') AND NOT has_table_privilege('anon','public.dictionary_words','SELECT,INSERT,UPDATE,DELETE'),
 'publishedAudio',(SELECT count(*) FROM public.lessons l WHERE l.published AND (l.retired_audio OR l.skills @> ARRAY['listening']::text[] OR EXISTS(SELECT 1 FROM public.exercises e WHERE e.lesson_id=l.id AND e.kind IN('listening','dictation')))))
$$;
REVOKE ALL ON FUNCTION public.dictionary_database_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.dictionary_database_status() TO service_role;
COMMIT;
