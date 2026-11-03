BEGIN;
-- Cover relationship lookups and FK checks without changing grants or application data.
CREATE INDEX IF NOT EXISTS admin_audit_actor_time_idx
  ON public.admin_audit_events(actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS star_events_order_idx
  ON public.star_events(order_id);
-- xp_events.attempt_id already has a UNIQUE index: its composite FK can use that
-- single-row lookup. A second index over (attempt_id,user_id,lesson_id) is redundant.
COMMIT;
