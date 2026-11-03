BEGIN;
CREATE TABLE public.curriculum_packages (
 id text PRIMARY KEY CHECK(id ~ '^[a-z0-9-]{3,80}$'), revision integer NOT NULL CHECK(revision>0),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{32}$'), inventory jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(inventory)='object'),
 counts jsonb NOT NULL DEFAULT '{}', imported_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.curriculum_packages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.curriculum_packages FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.curriculum_packages TO service_role;
ALTER TABLE public.courses ADD COLUMN content_package_id text REFERENCES public.curriculum_packages(id);
ALTER TABLE public.units ADD COLUMN content_package_id text REFERENCES public.curriculum_packages(id);
ALTER TABLE public.lessons ADD COLUMN content_package_id text REFERENCES public.curriculum_packages(id);
ALTER TABLE public.exercises ADD COLUMN content_package_id text REFERENCES public.curriculum_packages(id);
CREATE INDEX courses_package_idx ON public.courses(content_package_id);
CREATE INDEX units_package_idx ON public.units(content_package_id);
CREATE INDEX lessons_package_idx ON public.lessons(content_package_id);
CREATE INDEX exercises_package_idx ON public.exercises(content_package_id);
ALTER TABLE public.lessons ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE public.lessons ADD COLUMN cefr_level text CHECK(cefr_level IN ('A1','A2','B1','B2','C1','C2'));
ALTER TABLE public.lessons ADD COLUMN skills text[] NOT NULL DEFAULT '{}' CHECK(skills <@ ARRAY['grammar','vocabulary','reading','listening']::text[]);
ALTER TABLE public.lessons ADD COLUMN estimated_minutes smallint CHECK(estimated_minutes BETWEEN 1 AND 45);
ALTER TABLE public.lessons ADD COLUMN content_quality jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(content_quality)='object');
CREATE TABLE public.lesson_prerequisites (
 lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
 prerequisite_id uuid NOT NULL REFERENCES public.lessons(id),
 PRIMARY KEY(lesson_id,prerequisite_id), CHECK(lesson_id<>prerequisite_id)
);
CREATE INDEX prerequisites_reverse_idx ON public.lesson_prerequisites(prerequisite_id);
ALTER TABLE public.lesson_prerequisites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lesson_prerequisites FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.lesson_prerequisites TO service_role;
CREATE FUNCTION public.curriculum_prerequisite_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF EXISTS(WITH RECURSIVE reachable(id) AS (SELECT NEW.prerequisite_id UNION SELECT p.prerequisite_id FROM public.lesson_prerequisites p JOIN reachable r ON r.id=p.lesson_id) SELECT 1 FROM reachable WHERE id=NEW.lesson_id) THEN RAISE EXCEPTION 'curriculum prerequisite cycle'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER curriculum_prerequisite_cycle AFTER INSERT OR UPDATE ON public.lesson_prerequisites DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.curriculum_prerequisite_guard();
CREATE FUNCTION public.curriculum_inventory(p_package text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT jsonb_build_object(
  'courses',coalesce((SELECT jsonb_object_agg(id::text,admin_version) FROM public.courses WHERE content_package_id=p_package),'{}'),
  'units',coalesce((SELECT jsonb_object_agg(id::text,admin_version) FROM public.units WHERE content_package_id=p_package),'{}'),
  'lessons',coalesce((SELECT jsonb_object_agg(id::text,admin_version) FROM public.lessons WHERE content_package_id=p_package),'{}'),
  'exercises',coalesce((SELECT jsonb_object_agg(id::text,admin_version) FROM public.exercises WHERE content_package_id=p_package),'{}'),
  'prerequisites',coalesce((SELECT jsonb_agg(jsonb_build_array(p.lesson_id,p.prerequisite_id) ORDER BY p.lesson_id,p.prerequisite_id) FROM public.lesson_prerequisites p JOIN public.lessons l ON l.id=p.lesson_id WHERE l.content_package_id=p_package),'[]'))
$$;
-- All application content writes share the import lock; existing confirmation/audit/version checks remain intact.
ALTER FUNCTION public.admin_save_content(uuid,uuid,text,jsonb,text) RENAME TO admin_save_content_core;
REVOKE ALL ON FUNCTION public.admin_save_content_core(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE FUNCTION public.admin_save_content(p_actor uuid,p_request uuid,p_entity text,p_data jsonb,p_confirmation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(73572026);
 RETURN public.admin_save_content_core(p_actor,p_request,p_entity,p_data,p_confirmation);
END $$;
REVOKE ALL ON FUNCTION public.admin_save_content(uuid,uuid,text,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_save_content(uuid,uuid,text,jsonb,text) TO service_role;
CREATE FUNCTION public.import_curriculum_package(p_catalog jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE pkg text; rev integer; fingerprint text; prior public.curriculum_packages; t text; entry jsonb; payload jsonb; v_counts jsonb; language_uuid uuid; child record; predecessor record;
BEGIN
 PERFORM pg_advisory_xact_lock(73572026);
 IF p_catalog->>'schema_version' IS DISTINCT FROM '2' OR p_catalog->>'language' IS DISTINCT FROM 'en' OR octet_length(p_catalog::text)>4000000 THEN RAISE EXCEPTION 'curriculum invalid manifest'; END IF;
 pkg:=p_catalog->>'package_id';rev:=(p_catalog->>'revision')::integer;fingerprint:=md5(p_catalog::text);
 IF pkg IS NULL OR pkg !~ '^[a-z0-9-]{3,80}$' OR rev IS NULL OR rev<1 THEN RAISE EXCEPTION 'curriculum invalid identity'; END IF;
 FOREACH t IN ARRAY ARRAY['courses','units','lessons','exercises'] LOOP
  IF jsonb_typeof(p_catalog->t) IS DISTINCT FROM 'array' OR jsonb_array_length(p_catalog->t)<1 THEN RAISE EXCEPTION 'curriculum empty manifest'; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(p_catalog->t))<>jsonb_array_length(p_catalog->t) THEN RAISE EXCEPTION 'curriculum duplicate identifiers'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_catalog->t) x WHERE coalesce(x->>'id','') !~ '^[a-f0-9-]{36}$') THEN RAISE EXCEPTION 'curriculum invalid id'; END IF;
 END LOOP;
 IF jsonb_array_length(p_catalog->'lessons')>500 OR jsonb_array_length(p_catalog->'exercises')>7500 THEN RAISE EXCEPTION 'curriculum package too large'; END IF;
 SELECT * INTO prior FROM public.curriculum_packages WHERE id=pkg FOR UPDATE;
 IF FOUND THEN
  IF prior.inventory IS DISTINCT FROM public.curriculum_inventory(pkg) THEN RAISE EXCEPTION 'curriculum manual edits conflict'; END IF;
  IF rev<prior.revision OR (rev=prior.revision AND fingerprint<>prior.digest) THEN RAISE EXCEPTION 'curriculum revision conflict'; END IF;
  IF fingerprint=prior.digest THEN RETURN prior.counts||jsonb_build_object('unchanged',true); END IF;
 END IF;
 FOREACH t IN ARRAY ARRAY['courses','units','lessons','exercises'] LOOP
  -- Refuse to take ownership of legacy/another package's rows, and never silently remove managed content.
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(coalesce(prior.inventory->t,'{}')) owned WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_catalog->t) x WHERE x->>'id'=owned)) THEN RAISE EXCEPTION 'curriculum removal requires explicit archival'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(p_catalog->t) LOOP
   EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE id=$1 AND content_package_id IS DISTINCT FROM $2)',t) INTO child USING (entry->>'id')::uuid,pkg;
   IF child.exists THEN RAISE EXCEPTION 'curriculum foreign ownership conflict'; END IF;
  END LOOP;
 END LOOP;
 INSERT INTO public.curriculum_packages(id,revision,digest) VALUES(pkg,rev,fingerprint) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,digest=excluded.digest;
 SELECT id INTO language_uuid FROM public.languages WHERE code='en' AND active;
 IF language_uuid IS NULL THEN RAISE EXCEPTION 'curriculum English unavailable'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_catalog->'courses') LOOP
  IF length(trim(entry->>'title')) NOT BETWEEN 1 AND 160 OR length(trim(entry->>'description')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'curriculum incomplete course'; END IF;
  INSERT INTO public.courses(id,language_id,slug,title,level,description,published,access_tier,learning_goals,content_version,content_package_id)
  VALUES((entry->>'id')::uuid,language_uuid,entry->>'slug',entry->>'title',entry->>'level',entry->>'description',true,'free',ARRAY(SELECT jsonb_array_elements_text(entry->'goals')),rev::text,pkg)
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,level=excluded.level,description=excluded.description,learning_goals=excluded.learning_goals,content_version=excluded.content_version;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_catalog->'units') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_catalog->'courses') x WHERE x->>'id'=entry->>'course_id') THEN RAISE EXCEPTION 'curriculum invalid unit parent'; END IF;
  IF EXISTS(SELECT 1 FROM public.units WHERE id=(entry->>'id')::uuid AND course_id<>(entry->>'course_id')::uuid) THEN RAISE EXCEPTION 'curriculum parent conflict'; END IF;
  INSERT INTO public.units(id,course_id,title,position,content_package_id) VALUES((entry->>'id')::uuid,(entry->>'course_id')::uuid,entry->>'title',(entry->>'position')::integer,pkg)
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,position=excluded.position;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_catalog->'lessons') LOOP
  IF jsonb_typeof(entry->'objectives') IS DISTINCT FROM 'array' OR jsonb_typeof(entry->'notes') IS DISTINCT FROM 'array' OR jsonb_typeof(entry->'lexicon') IS DISTINCT FROM 'array' OR jsonb_typeof(entry->'skills') IS DISTINCT FROM 'array' OR jsonb_typeof(entry->'prerequisites') IS DISTINCT FROM 'array' OR coalesce((entry->>'estimated_minutes')::integer,0) NOT BETWEEN 3 AND 30 THEN RAISE EXCEPTION 'curriculum incomplete metadata'; END IF;
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_catalog->'units') x WHERE x->>'id'=entry->>'unit_id') OR entry->'quality'->>'status' IS DISTINCT FROM 'checked' OR jsonb_array_length(entry->'objectives')<2 OR jsonb_array_length(entry->'notes')<2 OR jsonb_array_length(entry->'lexicon')<4 OR length(trim(entry->>'description')) NOT BETWEEN 20 AND 2000 OR jsonb_array_length(entry->'skills')<1 THEN RAISE EXCEPTION 'curriculum incomplete lesson'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.units u JOIN public.courses c ON c.id=u.course_id WHERE u.id=(entry->>'unit_id')::uuid AND c.level=entry->>'level') THEN RAISE EXCEPTION 'curriculum level mismatch'; END IF;
  IF EXISTS(SELECT 1 FROM public.lessons WHERE id=(entry->>'id')::uuid AND unit_id<>(entry->>'unit_id')::uuid) THEN RAISE EXCEPTION 'curriculum parent conflict'; END IF;
  INSERT INTO public.lessons(id,unit_id,title,position,xp_reward,objectives,notes,lexicon,published,description,cefr_level,skills,estimated_minutes,content_quality,content_package_id)
  VALUES((entry->>'id')::uuid,(entry->>'unit_id')::uuid,entry->>'title',(entry->>'position')::integer,(entry->>'xp_reward')::integer,entry->'objectives',entry->'notes',entry->'lexicon',true,entry->>'description',entry->>'level',ARRAY(SELECT jsonb_array_elements_text(entry->'skills')),(entry->>'estimated_minutes')::smallint,entry->'quality',pkg)
  ON CONFLICT(id) DO UPDATE SET title=excluded.title,position=excluded.position,xp_reward=excluded.xp_reward,objectives=excluded.objectives,notes=excluded.notes,lexicon=excluded.lexicon,description=excluded.description,cefr_level=excluded.cefr_level,skills=excluded.skills,estimated_minutes=excluded.estimated_minutes,content_quality=excluded.content_quality;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_catalog->'exercises') LOOP
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_catalog->'lessons') x WHERE x->>'id'=entry->>'lesson_id') OR length(trim(entry->>'explanation')) NOT BETWEEN 1 AND 2000 THEN RAISE EXCEPTION 'curriculum invalid exercise parent or explanation'; END IF;
  payload:=public.lesson_public_payload(entry->>'kind',entry->'public_payload');
  IF payload IS DISTINCT FROM entry->'public_payload' OR NOT public.lesson_key_valid(entry->>'kind',payload,entry->'answer_key') OR NOT public.lesson_check_answer(entry->>'kind',payload,entry->'answer_key',entry->'reference_answer') OR NOT public.lesson_answer_valid(entry->>'kind',payload,entry->'incorrect_answer') OR public.lesson_check_answer(entry->>'kind',payload,entry->'answer_key',entry->'incorrect_answer') THEN RAISE EXCEPTION 'curriculum invalid exercise or editorial reference'; END IF;
  IF EXISTS(SELECT 1 FROM public.exercises WHERE id=(entry->>'id')::uuid AND lesson_id<>(entry->>'lesson_id')::uuid) THEN RAISE EXCEPTION 'curriculum parent conflict'; END IF;
  INSERT INTO public.exercises(id,lesson_id,kind,prompt,position,public_payload,answer_key,explanation,content_package_id)
  VALUES((entry->>'id')::uuid,(entry->>'lesson_id')::uuid,entry->>'kind',entry->>'prompt',(entry->>'position')::integer,payload,entry->'answer_key',entry->>'explanation',pkg)
  ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,prompt=excluded.prompt,position=excluded.position,public_payload=excluded.public_payload,answer_key=excluded.answer_key,explanation=excluded.explanation;
 END LOOP;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_catalog->'lessons') LOOP
  IF (SELECT count(*) FROM public.exercises WHERE lesson_id=(entry->>'id')::uuid) NOT BETWEEN 8 AND 15 OR (SELECT count(DISTINCT kind) FROM public.exercises WHERE lesson_id=(entry->>'id')::uuid)<6 THEN RAISE EXCEPTION 'curriculum lesson needs 8-15 varied exercises'; END IF;
  DELETE FROM public.lesson_prerequisites WHERE lesson_id=(entry->>'id')::uuid;
  FOR predecessor IN SELECT value::uuid AS id FROM jsonb_array_elements_text(entry->'prerequisites') LOOP
   SELECT l.id,u.course_id,u.position AS unit_position,l.position INTO child FROM public.lessons l JOIN public.units u ON u.id=l.unit_id WHERE l.id=(entry->>'id')::uuid;
   IF NOT EXISTS(SELECT 1 FROM public.lessons l JOIN public.units u ON u.id=l.unit_id WHERE l.id=predecessor.id AND l.content_package_id=pkg AND u.course_id=child.course_id AND (u.position<child.unit_position OR (u.position=child.unit_position AND l.position<child.position))) THEN RAISE EXCEPTION 'curriculum invalid prerequisite'; END IF;
   INSERT INTO public.lesson_prerequisites VALUES(child.id,predecessor.id);
  END LOOP;
 END LOOP;
 v_counts:=jsonb_build_object('package',pkg,'revision',rev,'courses',jsonb_array_length(p_catalog->'courses'),'lessons',jsonb_array_length(p_catalog->'lessons'),'exercises',jsonb_array_length(p_catalog->'exercises'));
 UPDATE public.curriculum_packages SET inventory=public.curriculum_inventory(pkg),counts=v_counts,imported_at=now() WHERE id=pkg;
 RETURN v_counts||jsonb_build_object('unchanged',false);
END $$;
CREATE FUNCTION public.curriculum_library() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'description',c.description,'level',c.level,'tier',c.access_tier,'lessons',c.lessons) ORDER BY public.placement_rank(c.level),c.title),'[]') FROM (
 SELECT c.*, (SELECT coalesce(jsonb_agg(jsonb_build_object('id',l.id,'title',l.title,'description',l.description,'level',coalesce(l.cefr_level,c.level),'minutes',l.estimated_minutes,'skills',l.skills,'objectives',l.objectives,'notes',l.notes,'unit',u.title,'preview',l.free_preview,'prerequisites',(SELECT coalesce(jsonb_agg(prerequisite_id ORDER BY prerequisite_id),'[]') FROM public.lesson_prerequisites WHERE lesson_id=l.id)) ORDER BY u.position,l.position),'[]') FROM public.units u JOIN public.lessons l ON l.unit_id=u.id WHERE u.course_id=c.id AND l.published AND EXISTS(SELECT 1 FROM public.exercises e WHERE e.lesson_id=l.id)) AS lessons
 FROM public.courses c JOIN public.languages lang ON lang.id=c.language_id WHERE c.published AND lang.active AND lang.code='en'
 ) c
$$;
CREATE FUNCTION public.curriculum_database_status() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE ok boolean:=true; t text; f text;
BEGIN
 FOREACH t IN ARRAY ARRAY['curriculum_packages','lesson_prerequisites'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=('public.'||t)::regclass AND relrowsecurity) OR has_table_privilege('anon','public.'||t,'SELECT,INSERT,UPDATE,DELETE') OR has_table_privilege('authenticated','public.'||t,'SELECT,INSERT,UPDATE,DELETE') THEN ok:=false; END IF;
 END LOOP;
 FOREACH f IN ARRAY ARRAY['public.import_curriculum_package(jsonb)','public.curriculum_library()','public.curriculum_inventory(text)','public.curriculum_database_status()','public.admin_save_content_core(uuid,uuid,text,jsonb,text)'] LOOP
  IF has_function_privilege('anon',f,'EXECUTE') OR has_function_privilege('authenticated',f,'EXECUTE') THEN ok:=false; END IF;
 END LOOP;
 RETURN jsonb_build_object('ready',ok,'version','curriculum-v2','packages',(SELECT coalesce(jsonb_agg(counts ORDER BY id),'[]') FROM public.curriculum_packages));
END $$;
REVOKE ALL ON FUNCTION public.curriculum_prerequisite_guard(),public.curriculum_inventory(text),public.import_curriculum_package(jsonb),public.curriculum_library(),public.curriculum_database_status() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.import_curriculum_package(jsonb),public.curriculum_library(),public.curriculum_database_status() TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
