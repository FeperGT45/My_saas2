BEGIN;
CREATE TABLE public.users (
 id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 telegram_id bigint UNIQUE CHECK (telegram_id > 0),
 display_name text NOT NULL CHECK (length(display_name) BETWEEN 1 AND 80),
 locale text NOT NULL DEFAULT 'ru' CHECK (locale ~ '^[a-z]{2}(-[A-Z]{2})?$'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.languages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE CHECK (code ~ '^[a-z]{2,3}$'),
 name text NOT NULL CHECK (length(name)>0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.courses (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), language_id uuid NOT NULL REFERENCES public.languages(id),
 slug text NOT NULL UNIQUE, title text NOT NULL, level text NOT NULL CHECK (level IN ('A1','A2','B1','B2','C1','C2')),
 published boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX courses_language_idx ON public.courses(language_id);
CREATE TABLE public.units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
 title text NOT NULL, position integer NOT NULL CHECK (position>0), UNIQUE(course_id,position)
);
CREATE TABLE public.lessons (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
 title text NOT NULL, position integer NOT NULL CHECK (position>0), xp_reward integer NOT NULL DEFAULT 10 CHECK (xp_reward BETWEEN 0 AND 1000),
 published boolean NOT NULL DEFAULT false, UNIQUE(unit_id,position)
);
CREATE TABLE public.exercises (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
 kind text NOT NULL DEFAULT 'single_choice' CHECK (kind='single_choice'), prompt text NOT NULL,
 explanation text NOT NULL DEFAULT '', position integer NOT NULL CHECK (position>0), UNIQUE(lesson_id,position)
);
CREATE TABLE public.exercise_options (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), exercise_id uuid NOT NULL REFERENCES public.exercises(id) ON DELETE CASCADE,
 label text NOT NULL CHECK (length(label)>0), position integer NOT NULL CHECK (position>0),
 is_correct boolean NOT NULL DEFAULT false, UNIQUE(exercise_id,position)
);
CREATE UNIQUE INDEX exercise_one_correct_idx ON public.exercise_options(exercise_id) WHERE is_correct;
-- Deferred check permits multi-row authoring but rejects incomplete single-choice questions at commit.
CREATE FUNCTION public.check_exercise_options() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE target uuid; targets uuid[];
BEGIN
 IF TG_TABLE_NAME='exercises' THEN targets:=ARRAY[NEW.id];
 ELSIF TG_OP='INSERT' THEN targets:=ARRAY[NEW.exercise_id];
 ELSIF TG_OP='DELETE' THEN targets:=ARRAY[OLD.exercise_id];
 ELSE targets:=ARRAY[NEW.exercise_id,OLD.exercise_id]; END IF;
 FOR target IN SELECT DISTINCT x FROM unnest(targets) AS x WHERE x IS NOT NULL LOOP
  IF EXISTS(SELECT 1 FROM public.exercises WHERE id=target) AND
   ((SELECT count(*) FROM public.exercise_options WHERE exercise_id=target)<2 OR
    (SELECT count(*) FROM public.exercise_options WHERE exercise_id=target AND is_correct)<>1) THEN
    RAISE EXCEPTION 'single_choice needs at least two options and exactly one answer' USING ERRCODE='23514';
  END IF;
 END LOOP;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER exercise_options_valid AFTER INSERT OR UPDATE OR DELETE ON public.exercise_options DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_exercise_options();
CREATE CONSTRAINT TRIGGER exercise_valid AFTER INSERT OR UPDATE ON public.exercises DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.check_exercise_options();
CREATE TABLE public.user_progress (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 lesson_id uuid NOT NULL REFERENCES public.lessons(id) ON DELETE CASCADE,
 completed_at timestamptz NOT NULL DEFAULT now(), best_score integer NOT NULL CHECK(best_score BETWEEN 0 AND 100),
 PRIMARY KEY(user_id,lesson_id)
);
CREATE INDEX progress_lesson_idx ON public.user_progress(lesson_id);
CREATE TABLE public.lesson_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 lesson_id uuid NOT NULL REFERENCES public.lessons(id), status text NOT NULL DEFAULT 'started' CHECK(status IN ('started','completed','abandoned')),
 score integer CHECK(score BETWEEN 0 AND 100), started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK ((status='completed' AND completed_at IS NOT NULL AND score IS NOT NULL) OR (status<>'completed' AND completed_at IS NULL AND score IS NULL)),
 CHECK (completed_at IS NULL OR completed_at>=started_at), UNIQUE(id,user_id,lesson_id)
);
CREATE INDEX attempts_user_time_idx ON public.lesson_attempts(user_id,started_at DESC);
CREATE INDEX attempts_lesson_idx ON public.lesson_attempts(lesson_id);
CREATE TABLE public.xp_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 lesson_id uuid NOT NULL REFERENCES public.lessons(id), attempt_id uuid NOT NULL UNIQUE,
 amount integer NOT NULL CHECK(amount BETWEEN 0 AND 1000), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(attempt_id,user_id,lesson_id) REFERENCES public.lesson_attempts(id,user_id,lesson_id),
 UNIQUE(user_id,lesson_id) -- award each lesson only once, even on retries
);
CREATE INDEX xp_user_time_idx ON public.xp_events(user_id,created_at DESC);
CREATE INDEX xp_lesson_idx ON public.xp_events(lesson_id);
CREATE TABLE public.achievements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, title text NOT NULL, description text NOT NULL,
 target integer NOT NULL CHECK(target>0), active boolean NOT NULL DEFAULT true
);
CREATE TABLE public.user_achievements (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 achievement_id uuid NOT NULL REFERENCES public.achievements(id), awarded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,achievement_id)
);
CREATE INDEX user_achievements_achievement_idx ON public.user_achievements(achievement_id);
CREATE TABLE public.daily_streaks (
 user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE, activity_date date NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,activity_date)
);
CREATE TABLE public.referrals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), referrer_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 referred_id uuid NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(referrer_id<>referred_id)
);
CREATE INDEX referrals_referrer_idx ON public.referrals(referrer_id);
CREATE TABLE public.subscriptions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
 plan text NOT NULL CHECK(plan IN ('plus','pro')), status text NOT NULL CHECK(status IN ('active','cancelled','expired')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL, provider_reference text UNIQUE,
 CHECK(ends_at>starts_at)
);
CREATE INDEX subscriptions_user_idx ON public.subscriptions(user_id,ends_at DESC);
CREATE UNIQUE INDEX subscriptions_one_active_idx ON public.subscriptions(user_id) WHERE status='active';
COMMIT;
