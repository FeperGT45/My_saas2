BEGIN;
ALTER TABLE public.courses ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE public.courses ADD COLUMN content_version text;
ALTER TABLE public.lessons ADD COLUMN objectives jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(objectives)='array');
ALTER TABLE public.lessons ADD COLUMN notes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(notes)='array');
ALTER TABLE public.lessons ADD COLUMN lexicon jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(lexicon)='array');
-- Reordering a managed catalog must not fail on transient position collisions.
ALTER TABLE public.units DROP CONSTRAINT units_course_id_position_key;
ALTER TABLE public.units ADD CONSTRAINT units_course_id_position_key UNIQUE(course_id,position) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.lessons DROP CONSTRAINT lessons_unit_id_position_key;
ALTER TABLE public.lessons ADD CONSTRAINT lessons_unit_id_position_key UNIQUE(unit_id,position) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE public.exercises DROP CONSTRAINT exercises_lesson_id_position_key;
ALTER TABLE public.exercises ADD CONSTRAINT exercises_lesson_id_position_key UNIQUE(lesson_id,position) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION public.import_english_curriculum(p_catalog jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE language_uuid uuid; entry record; payload jsonb; expected integer;
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(73572026);
 IF p_catalog->'language'->>'code'<>'en' OR jsonb_array_length(p_catalog->'courses')<>3 OR jsonb_array_length(p_catalog->'lessons')<30 OR jsonb_array_length(p_catalog->'exercises')<240 THEN RAISE EXCEPTION 'invalid curriculum manifest'; END IF;
 INSERT INTO public.languages(code,name,active) VALUES('en',p_catalog->'language'->>'name',true)
 ON CONFLICT(code) DO UPDATE SET name=excluded.name RETURNING id INTO language_uuid;
 INSERT INTO public.courses(id,language_id,slug,title,level,description,content_version,published)
 SELECT id,language_uuid,slug,title,level,description,p_catalog->>'content_version',true FROM jsonb_to_recordset(p_catalog->'courses') AS c(id uuid,slug text,title text,level text,description text)
 ON CONFLICT(id) DO UPDATE SET title=excluded.title,level=excluded.level,description=excluded.description,content_version=excluded.content_version,published=true;
 INSERT INTO public.units(id,course_id,title,position)
 SELECT id,course_id,title,position FROM jsonb_to_recordset(p_catalog->'units') AS u(id uuid,course_id uuid,title text,position integer)
 ON CONFLICT(id) DO UPDATE SET course_id=excluded.course_id,title=excluded.title,position=excluded.position;
 INSERT INTO public.lessons(id,unit_id,title,position,xp_reward,objectives,notes,lexicon,published)
 SELECT id,unit_id,title,position,xp_reward,objectives,notes,lexicon,true FROM jsonb_to_recordset(p_catalog->'lessons') AS l(id uuid,unit_id uuid,title text,position integer,xp_reward integer,objectives jsonb,notes jsonb,lexicon jsonb)
 ON CONFLICT(id) DO UPDATE SET unit_id=excluded.unit_id,title=excluded.title,position=excluded.position,xp_reward=excluded.xp_reward,objectives=excluded.objectives,notes=excluded.notes,lexicon=excluded.lexicon,published=true;
 INSERT INTO public.exercises(id,lesson_id,kind,prompt,position,public_payload,answer_key,explanation)
 SELECT id,lesson_id,kind,prompt,position,public_payload,answer_key,explanation FROM jsonb_to_recordset(p_catalog->'exercises') AS x(id uuid,lesson_id uuid,kind text,prompt text,position integer,public_payload jsonb,answer_key jsonb,explanation text)
 ON CONFLICT(id) DO UPDATE SET lesson_id=excluded.lesson_id,kind=excluded.kind,prompt=excluded.prompt,position=excluded.position,public_payload=excluded.public_payload,answer_key=excluded.answer_key,explanation=excluded.explanation;
 DELETE FROM public.exercises e WHERE e.lesson_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_catalog->'lessons') x) AND e.id NOT IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_catalog->'exercises') x);
 -- Validate against the exact production grader before transaction commit/publication.
 FOR entry IN SELECT * FROM public.exercises WHERE lesson_id IN (SELECT (x->>'id')::uuid FROM jsonb_array_elements(p_catalog->'lessons') x) LOOP
  payload:=public.lesson_public_payload(entry.kind,entry.public_payload);
  IF NOT coalesce(public.lesson_key_valid(entry.kind,payload,entry.answer_key),false) THEN RAISE EXCEPTION 'invalid exercise key'; END IF;
 END LOOP;
 FOR entry IN SELECT (x->>'id')::uuid AS id FROM jsonb_array_elements(p_catalog->'lessons') x LOOP
  SELECT count(*) INTO expected FROM public.exercises WHERE lesson_id=entry.id;
  IF expected<8 OR (SELECT count(DISTINCT kind) FROM public.exercises WHERE lesson_id=entry.id)<6 THEN RAISE EXCEPTION 'lesson requires eight varied exercises'; END IF;
 END LOOP;
 RETURN jsonb_build_object('courses',jsonb_array_length(p_catalog->'courses'),'units',jsonb_array_length(p_catalog->'units'),'lessons',jsonb_array_length(p_catalog->'lessons'),'exercises',jsonb_array_length(p_catalog->'exercises'));
END $$;
REVOKE ALL ON FUNCTION public.import_english_curriculum(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.import_english_curriculum(jsonb) TO service_role;
COMMIT;
