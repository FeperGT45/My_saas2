BEGIN;
CREATE INDEX challenge_equipment_badge ON public.challenge_equipment(user_id,badge);
CREATE INDEX challenge_equipment_frame ON public.challenge_equipment(user_id,frame);
CREATE INDEX challenge_equipment_accent ON public.challenge_equipment(user_id,accent);
CREATE INDEX challenge_sprint_enrollment_owner ON public.challenge_sprints(enrollment_id,user_id);
COMMIT;
