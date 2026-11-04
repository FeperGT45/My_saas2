import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
export async function weakTopics(db: PGlite) {
  const unit = '30000000-0000-0000-0000-000000000001',
    topics = [randomUUID(), randomUUID()];
  for (const [j, topic] of topics.entries()) {
    await db.query(
      "INSERT INTO public.lessons(id,unit_id,title,position,published,cefr_level) VALUES($1,$2,$3,$4,true,'A1')",
      [topic, unit, j === 0 ? 'Формы be' : 'Местоимения', 40 + j],
    );
    for (let i = 1; i <= 8; i++)
      await db.query(
        'INSERT INTO public.exercises(id,lesson_id,kind,prompt,explanation,position,public_payload,answer_key) VALUES($1,$2,\'grammar\',$3,\'С I используется am.\',$4,\'{"options":[{"id":"a","label":"I am ready."},{"id":"b","label":"I is ready."}]}\',\'{"value":"a"}\')',
        [randomUUID(), topic, `Выбери правильную форму · ${j + 1}.${i}`, i],
      );
  }
  return topics;
}
export async function weakLesson(
  db: PGlite,
  user: string,
  topic: string,
  wrong = 3,
  count = 5,
) {
  const attempt = randomUUID();
  await db.query(
    "INSERT INTO public.lesson_attempts(id,user_id,lesson_id,started_at) VALUES($1,$2,$3,now()-interval '1 hour')",
    [attempt, user, topic],
  );
  await db.query(
    'INSERT INTO public.lesson_attempt_items(attempt_id,position,exercise_id,kind,prompt,payload,answer_key,explanation) SELECT $1,position,id,kind,prompt,public_payload,answer_key,explanation FROM public.exercises WHERE lesson_id=$2 AND position<=$3',
    [attempt, topic, count],
  );
  await db.query(
    "INSERT INTO public.exercise_submissions(attempt_id,position,answer,correct,feedback) SELECT $1,position,to_jsonb(CASE WHEN position<=$2 THEN 'b'::text ELSE 'a'::text END),position>$2,'Fixture feedback' FROM public.lesson_attempt_items WHERE attempt_id=$1",
    [attempt, wrong],
  );
  await db.query(
    "UPDATE public.lesson_attempts SET status='completed',score=$2,completed_at=now() WHERE id=$1",
    [attempt, Math.round((100 * (count - wrong)) / count)],
  );
  return attempt;
}
