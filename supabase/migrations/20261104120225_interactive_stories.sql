BEGIN;
-- Immutable editorial revisions. Only metadata columns, never graphs/answer keys, are client-readable.
CREATE TABLE public.interactive_stories (
 slug text NOT NULL CHECK(slug ~ '^[a-z][a-z0-9-]{0,79}$'), revision integer NOT NULL CHECK(revision>0),
 title text NOT NULL CHECK(length(title) BETWEEN 3 AND 120), subtitle text NOT NULL CHECK(length(subtitle) BETWEEN 3 AND 120),
 description text NOT NULL CHECK(length(description) BETWEEN 30 AND 500),
 level text NOT NULL CHECK(level IN ('A1','A2','B1','B2')), minutes integer NOT NULL CHECK(minutes BETWEEN 5 AND 60),
 free_preview boolean NOT NULL DEFAULT false, published boolean NOT NULL DEFAULT false, document jsonb NOT NULL,
 PRIMARY KEY(slug,revision)
);
CREATE UNIQUE INDEX stories_published_slug ON public.interactive_stories(slug) WHERE published;
CREATE TABLE public.story_attempts (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 story_slug text NOT NULL, story_revision integer NOT NULL, node_id text NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','completed','abandoned')),
 version integer NOT NULL DEFAULT 0 CHECK(version BETWEEN 0 AND 80),
 path jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(path)='array' AND jsonb_array_length(path)<=80),
 answered integer NOT NULL DEFAULT 0 CHECK(answered>=0), correct integer NOT NULL DEFAULT 0 CHECK(correct BETWEEN 0 AND answered),
 reward text, new_ending boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 FOREIGN KEY(story_slug,story_revision) REFERENCES public.interactive_stories(slug,revision), UNIQUE(id,user_id)
);
CREATE UNIQUE INDEX story_active_user_slug ON public.story_attempts(user_id,story_slug) WHERE status='active';
CREATE INDEX story_attempts_story ON public.story_attempts(story_slug,story_revision);
CREATE INDEX story_attempts_user_time ON public.story_attempts(user_id,updated_at DESC);
CREATE TABLE public.story_endings (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, story_slug text NOT NULL, story_revision integer NOT NULL,
 ending_id text NOT NULL, title text NOT NULL, reward text NOT NULL, obtained_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,story_slug,ending_id), FOREIGN KEY(story_slug,story_revision) REFERENCES public.interactive_stories(slug,revision)
);
CREATE INDEX story_endings_story ON public.story_endings(story_slug,story_revision);
CREATE TABLE public.story_choice_events (
 attempt_id uuid NOT NULL, user_id uuid NOT NULL, request_id uuid NOT NULL, from_version integer NOT NULL,
 choice_id text NOT NULL, feedback jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(attempt_id,request_id), UNIQUE(attempt_id,from_version),
 FOREIGN KEY(attempt_id,user_id) REFERENCES public.story_attempts(id,user_id) ON DELETE CASCADE
);
CREATE INDEX story_choice_events_user ON public.story_choice_events(user_id);
ALTER TABLE public.interactive_stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_endings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.story_choice_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.interactive_stories,public.story_attempts,public.story_endings,public.story_choice_events FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.interactive_stories,public.story_attempts,public.story_endings,public.story_choice_events TO service_role;
GRANT SELECT(slug,revision,title,subtitle,description,level,minutes,free_preview,published) ON public.interactive_stories TO authenticated;
GRANT SELECT ON public.story_attempts,public.story_endings TO authenticated;
CREATE POLICY story_metadata_read ON public.interactive_stories FOR SELECT TO authenticated USING(published);
CREATE POLICY story_attempt_owner ON public.story_attempts FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));
CREATE POLICY story_ending_owner ON public.story_endings FOR SELECT TO authenticated USING(user_id=(SELECT auth.uid()));

-- Validate graphs at the database boundary as well as in the editorial importer.
CREATE FUNCTION public.story_validate_document() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE nodes jsonb:=NEW.document->'nodes'; item record; option_value jsonb; n jsonb; ids text[]; reached text[]; previous integer; remaining text[]; roots text[]; endings integer:=0; tasks integer:=0; branches integer:=0;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF NEW.document IS DISTINCT FROM OLD.document OR NEW.slug<>OLD.slug OR NEW.revision<>OLD.revision OR NEW.title<>OLD.title OR NEW.level<>OLD.level THEN RAISE EXCEPTION 'story revision is immutable'; END IF;
  RETURN NEW;
 END IF;
 IF jsonb_typeof(nodes) IS DISTINCT FROM 'object' OR octet_length(NEW.document::text)>200000 THEN RAISE EXCEPTION 'invalid story graph'; END IF;
 SELECT array_agg(key) INTO ids FROM jsonb_each(nodes);
 IF coalesce(cardinality(ids),0) NOT BETWEEN 15 AND 80 OR NOT coalesce(NEW.document->>'start'=ANY(ids),false) THEN RAISE EXCEPTION 'invalid story start'; END IF;
 FOR item IN SELECT * FROM jsonb_each(nodes) LOOP
  n:=item.value;
  IF item.key !~ '^[a-z][a-z0-9-]{0,79}$' OR coalesce(length(n->>'text'),0) NOT BETWEEN 40 AND 4000 OR coalesce(length(n->>'speaker'),0) NOT BETWEEN 1 AND 80 OR jsonb_typeof(n->'vocabulary') IS DISTINCT FROM 'array' OR jsonb_typeof(n->'choices') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid story node'; END IF;
  IF n ? 'ending' THEN
   endings:=endings+1;
   IF jsonb_array_length(n->'choices')<>0 OR n ? 'question' OR coalesce(length(n#>>'{ending,title}'),0) NOT BETWEEN 3 AND 100 OR coalesce(length(n#>>'{ending,reward}'),0) NOT BETWEEN 3 AND 100 THEN RAISE EXCEPTION 'invalid ending'; END IF;
  ELSIF jsonb_array_length(n->'choices') NOT BETWEEN 1 AND 4 THEN RAISE EXCEPTION 'invalid choices'; END IF;
  IF jsonb_array_length(n->'choices')>1 THEN branches:=branches+1; END IF;
  IF (SELECT count(DISTINCT value->>'id') FROM jsonb_array_elements(n->'choices'))<>jsonb_array_length(n->'choices') THEN RAISE EXCEPTION 'duplicate choice'; END IF;
  FOR option_value IN SELECT value FROM jsonb_array_elements(n->'choices') LOOP
   IF NOT coalesce(option_value->>'next'=ANY(ids),false) OR coalesce(option_value->>'id','') !~ '^[a-z][a-z0-9-]{0,79}$' OR coalesce(length(option_value->>'text'),0) NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid transition'; END IF;
   IF n ? 'question' THEN
    IF jsonb_typeof(option_value->'correct') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid grading'; END IF;
   ELSIF option_value ? 'correct' THEN RAISE EXCEPTION 'unexpected grading'; END IF;
  END LOOP;
  IF n ? 'question' THEN
   tasks:=tasks+1;
   IF coalesce(length(n->>'question'),0) NOT BETWEEN 5 AND 300 OR coalesce(length(n->>'explanation'),0) NOT BETWEEN 10 AND 1500 OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(n->'choices') WHERE value->'correct'='true'::jsonb) OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(n->'choices') WHERE value->'correct'='false'::jsonb) THEN RAISE EXCEPTION 'invalid exercise'; END IF;
  END IF;
 END LOOP;
 IF endings<2 OR tasks<2 OR branches<3 THEN RAISE EXCEPTION 'insufficient story variety'; END IF;
 reached:=ARRAY[NEW.document->>'start'];
 LOOP
  previous:=cardinality(reached);
  SELECT array_agg(DISTINCT id) INTO reached FROM (SELECT unnest(reached) AS id UNION SELECT c->>'next' FROM unnest(reached) r CROSS JOIN LATERAL jsonb_array_elements(nodes->r->'choices') c) t;
  EXIT WHEN cardinality(reached)=previous;
 END LOOP;
 IF cardinality(reached)<>cardinality(ids) THEN RAISE EXCEPTION 'unreachable story node'; END IF;
 remaining:=ids;
 WHILE cardinality(remaining)>0 LOOP
  SELECT array_agg(id) INTO roots FROM unnest(remaining) id WHERE NOT EXISTS(SELECT 1 FROM unnest(remaining) parent CROSS JOIN LATERAL jsonb_array_elements(nodes->parent->'choices') c WHERE c->>'next'=id);
  IF coalesce(cardinality(roots),0)=0 THEN RAISE EXCEPTION 'story cycle'; END IF;
  SELECT coalesce(array_agg(id),'{}'::text[]) INTO remaining FROM unnest(remaining) id WHERE NOT id=ANY(roots);
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_story BEFORE INSERT OR UPDATE ON public.interactive_stories FOR EACH ROW EXECUTE FUNCTION public.story_validate_document();

CREATE FUNCTION public.story_catalog(p_user uuid) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('stories',coalesce((SELECT jsonb_agg(jsonb_build_object(
 'slug',s.slug,'revision',s.revision,'title',s.title,'subtitle',s.subtitle,'description',s.description,'level',s.level,'minutes',s.minutes,
 'free',s.free_preview,'accessible',s.free_preview OR public.has_feature(p_user,'extra_exercises'),
 'nodes',(SELECT count(*) FROM jsonb_each(s.document->'nodes')),
 'endings',(SELECT count(*) FROM jsonb_each(s.document->'nodes') WHERE value ? 'ending'),
 'activeId',(SELECT a.id FROM public.story_attempts a WHERE a.user_id=p_user AND a.story_slug=s.slug AND a.status='active'),
 'completed',(SELECT count(*) FROM public.story_endings e WHERE e.user_id=p_user AND e.story_slug=s.slug)
 ) ORDER BY s.level,s.slug) FROM (SELECT * FROM public.interactive_stories WHERE published ORDER BY level,slug LIMIT 100) s),'[]'),
 'endings',coalesce((SELECT jsonb_agg(jsonb_build_object('slug',e.story_slug,'revision',e.story_revision,'ending',e.ending_id,'title',e.title,'reward',e.reward,'obtainedAt',e.obtained_at,'storyTitle',s.title) ORDER BY e.obtained_at DESC) FROM public.story_endings e JOIN public.interactive_stories s ON s.slug=e.story_slug AND s.revision=e.story_revision WHERE e.user_id=p_user),'[]'))
$$;
CREATE FUNCTION public.story_state(p_user uuid,p_attempt uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE a public.story_attempts; s public.interactive_stories; n jsonb; access boolean; transcript jsonb;
BEGIN
 SELECT * INTO a FROM public.story_attempts WHERE id=p_attempt AND user_id=p_user;
 IF NOT FOUND THEN RAISE EXCEPTION 'story unavailable'; END IF;
 SELECT * INTO s FROM public.interactive_stories WHERE slug=a.story_slug AND revision=a.story_revision;
 access:=s.free_preview OR public.has_feature(p_user,'extra_exercises'); n:=s.document->'nodes'->a.node_id;
 IF access THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('speaker',s.document#>>ARRAY['nodes',p->>'node','speaker'],'text',s.document#>>ARRAY['nodes',p->>'node','text'],'choice',(SELECT c->>'text' FROM jsonb_array_elements(s.document#>ARRAY['nodes',p->>'node','choices']) c WHERE c->>'id'=p->>'choice')) ORDER BY ord),'[]') INTO transcript FROM jsonb_array_elements(a.path) WITH ORDINALITY AS t(p,ord);
 END IF;
 RETURN jsonb_build_object('id',a.id,'slug',a.story_slug,'revision',a.story_revision,'title',s.title,'level',s.level,'version',a.version,'status',a.status,'accessible',access,'nodeId',a.node_id,'visited',jsonb_array_length(a.path)+1,'totalNodes',(SELECT count(*) FROM jsonb_each(s.document->'nodes')),
 'node',CASE WHEN access THEN (n-'explanation'-'choices')||jsonb_build_object('choices',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c->>'id','text',c->>'text')) FROM jsonb_array_elements(n->'choices') c),'[]')) ELSE NULL END,
 'transcript',coalesce(transcript,'[]'),'answered',a.answered,'correct',a.correct,'reward',a.reward,'newEnding',a.new_ending,'feedback',CASE WHEN access THEN (SELECT e.feedback FROM public.story_choice_events e WHERE e.attempt_id=a.id AND e.from_version=a.version-1) END);
END $$;
CREATE FUNCTION public.story_start(p_user uuid,p_slug text,p_request uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE s public.interactive_stories; a public.story_attempts;
BEGIN
 IF p_user IS NULL OR p_request IS NULL OR p_slug IS NULL THEN RAISE EXCEPTION 'invalid story request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':stories',0));
 SELECT * INTO a FROM public.story_attempts WHERE id=p_request;
 IF FOUND THEN
  IF a.user_id<>p_user OR a.story_slug<>p_slug THEN RAISE EXCEPTION 'story conflict'; END IF;
  SELECT * INTO s FROM public.interactive_stories WHERE slug=a.story_slug AND revision=a.story_revision;
  IF NOT (s.free_preview OR public.has_feature(p_user,'extra_exercises')) THEN RAISE EXCEPTION 'premium required'; END IF;
  RETURN public.story_state(p_user,a.id);
 END IF;
 SELECT * INTO s FROM public.interactive_stories WHERE slug=p_slug AND published;
 IF NOT FOUND THEN RAISE EXCEPTION 'story unavailable'; END IF;
 IF NOT (s.free_preview OR public.has_feature(p_user,'extra_exercises')) THEN RAISE EXCEPTION 'premium required'; END IF;
 UPDATE public.story_attempts SET status='abandoned',updated_at=now() WHERE user_id=p_user AND story_slug=p_slug AND status='active';
 INSERT INTO public.story_attempts(id,user_id,story_slug,story_revision,node_id) VALUES(p_request,p_user,s.slug,s.revision,s.document->>'start');
 RETURN public.story_state(p_user,p_request);
END $$;
CREATE FUNCTION public.story_choose(p_user uuid,p_attempt uuid,p_request uuid,p_version integer,p_choice text) RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
DECLARE a public.story_attempts; s public.interactive_stories; n jsonb; c jsonb; next_node jsonb; feedback jsonb; old public.story_choice_events; earned text; inserted integer:=0;
BEGIN
 IF p_user IS NULL OR p_request IS NULL OR p_version IS NULL OR p_choice IS NULL THEN RAISE EXCEPTION 'invalid story request'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_user::text||':stories',0));
 SELECT * INTO a FROM public.story_attempts WHERE id=p_attempt AND user_id=p_user FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'story unavailable'; END IF;
 SELECT * INTO s FROM public.interactive_stories WHERE slug=a.story_slug AND revision=a.story_revision;
 IF NOT (s.free_preview OR public.has_feature(p_user,'extra_exercises')) THEN RAISE EXCEPTION 'premium required'; END IF;
 SELECT * INTO old FROM public.story_choice_events WHERE attempt_id=p_attempt AND request_id=p_request;
 IF FOUND THEN
  IF old.from_version<>p_version OR old.choice_id<>p_choice THEN RAISE EXCEPTION 'story conflict'; END IF;
  RETURN public.story_state(p_user,p_attempt)||jsonb_build_object('feedback',old.feedback);
 END IF;
 IF a.status<>'active' OR a.version<>p_version THEN RAISE EXCEPTION 'story conflict'; END IF;
 n:=s.document->'nodes'->a.node_id;
 SELECT value INTO c FROM jsonb_array_elements(n->'choices') WHERE value->>'id'=p_choice;
 IF c IS NULL THEN RAISE EXCEPTION 'invalid story choice'; END IF;
 next_node:=s.document->'nodes'->(c->>'next');
 IF n ? 'question' THEN feedback:=jsonb_build_object('correct',(c->>'correct')::boolean,'explanation',n->>'explanation'); END IF;
 IF next_node ? 'ending' THEN
  earned:=next_node#>>'{ending,reward}';
  INSERT INTO public.story_endings(user_id,story_slug,story_revision,ending_id,title,reward) VALUES(p_user,s.slug,s.revision,c->>'next',next_node#>>'{ending,title}',earned) ON CONFLICT(user_id,story_slug,ending_id) DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
 END IF;
 UPDATE public.story_attempts SET node_id=c->>'next',version=version+1,path=path||jsonb_build_array(jsonb_build_object('node',a.node_id,'choice',p_choice)),
 answered=answered+CASE WHEN n ? 'question' THEN 1 ELSE 0 END,correct=correct+CASE WHEN c->>'correct'='true' THEN 1 ELSE 0 END,
 status=CASE WHEN next_node ? 'ending' THEN 'completed' ELSE 'active' END,completed_at=CASE WHEN next_node ? 'ending' THEN now() END,updated_at=now(),reward=earned,new_ending=inserted=1 WHERE id=p_attempt;
 INSERT INTO public.story_choice_events(attempt_id,user_id,request_id,from_version,choice_id,feedback) VALUES(p_attempt,p_user,p_request,p_version,p_choice,feedback);
 RETURN public.story_state(p_user,p_attempt)||jsonb_build_object('feedback',feedback);
END $$;
CREATE FUNCTION public.story_database_status() RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_build_object('version','stories-v1','ready',
 (SELECT count(*)=4 AND bool_and(relrowsecurity) FROM pg_class WHERE oid IN ('public.interactive_stories'::regclass,'public.story_attempts'::regclass,'public.story_endings'::regclass,'public.story_choice_events'::regclass))
 AND NOT has_function_privilege('authenticated','public.story_choose(uuid,uuid,uuid,integer,text)','EXECUTE')
 AND NOT has_function_privilege('anon','public.story_start(uuid,text,uuid)','EXECUTE')
 AND NOT has_column_privilege('authenticated','public.interactive_stories','document','SELECT')
 AND (SELECT count(*)>=5 AND count(*) FILTER(WHERE free_preview)>=1 FROM public.interactive_stories WHERE published),
 'published',(SELECT count(*) FROM public.interactive_stories WHERE published))
$$;
REVOKE ALL ON FUNCTION public.story_validate_document(),public.story_catalog(uuid),public.story_state(uuid,uuid),public.story_start(uuid,text,uuid),public.story_choose(uuid,uuid,uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.story_validate_document(),public.story_catalog(uuid),public.story_state(uuid,uuid),public.story_start(uuid,text,uuid),public.story_choose(uuid,uuid,uuid,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.story_database_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.story_database_status() TO service_role;
COMMIT;
