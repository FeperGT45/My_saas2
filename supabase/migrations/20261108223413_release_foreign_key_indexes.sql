-- Cover composite ownership foreign keys without changing rows, grants or RLS.
CREATE INDEX IF NOT EXISTS extended_answers_attempt_owner_idx ON public.extended_answers(attempt_id,user_id);
CREATE INDEX IF NOT EXISTS placement_answers_attempt_owner_idx ON public.placement_test_answers(attempt_id,user_id);
CREATE INDEX IF NOT EXISTS story_events_attempt_owner_idx ON public.story_choice_events(attempt_id,user_id);
CREATE INDEX IF NOT EXISTS language_levels_attempt_owner_language_idx ON public.user_language_levels(latest_attempt_id,user_id,language_id);
CREATE INDEX IF NOT EXISTS skill_assessments_attempt_owner_language_idx ON public.user_skill_assessments(attempt_id,user_id,language_id);
CREATE INDEX IF NOT EXISTS xp_events_attempt_owner_lesson_idx ON public.xp_events(attempt_id,user_id,lesson_id);
