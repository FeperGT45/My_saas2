BEGIN;
DO $$ DECLARE original text; updated text; BEGIN
 original:=pg_get_functiondef('public.challenge_command(uuid,jsonb)'::regprocedure);
 updated:=replace(original,$match$FROM public.weak_material(p_user) ORDER BY md5(exercise_id::text||request::text) LIMIT 5$match$,
 $replacement$FROM public.weak_material(p_user) WHERE kind IN ('single_choice','grammar','gap','context_choice','tenses','synonym_antonym','word_review','error_identification') AND length(prompt)<=350 AND octet_length(payload::text)<=1600 ORDER BY md5(exercise_id::text||request::text) LIMIT 5$replacement$);
 IF original=updated THEN RAISE EXCEPTION 'short challenge practice patch unavailable'; END IF;
 EXECUTE updated;
END $$;
COMMIT;
