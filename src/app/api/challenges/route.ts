import { lessonRequest, json, rpcError } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { challengeCommand, challengeQuery } from '@/lib/learning/challenges';
function failure(e: { message: string }) {
  if (e.message.includes('challenge conflict'))
    return json(
      { error: 'Состояние уже изменилось. Обнови страницу испытаний.' },
      409,
    );
  if (e.message.includes('challenge incomplete'))
    return json(
      {
        error:
          'Цель пока не достигнута. Прогресс проверяется по сохранённым результатам.',
      },
      422,
    );
  if (e.message.includes('challenge closed'))
    return json(
      {
        error:
          'Период испытания закончился. Можно выбрать новое испытание без потери прежних наград.',
      },
      422,
    );
  if (e.message.includes('materials unavailable'))
    return json(
      {
        error:
          'В базе пока нет пяти подходящих заданий твоего уровня. Выбери другое испытание.',
      },
      422,
    );
  if (e.message.includes('invalid challenge'))
    return json({ error: 'Проверь формат запроса или ответа.' }, 400);
  return rpcError(e);
}
export async function GET(request: Request) {
  return lessonRequest(request, false, async (u, db) => {
    let q;
    try {
      q = challengeQuery(new URL(request.url).searchParams);
    } catch {
      return json({ error: 'Некорректное испытание.' }, 400);
    }
    const call =
      q.view === 'showcase'
        ? db.rpc('challenge_showcase', { p_user: u })
        : q.view === 'sprint'
          ? db.rpc('challenge_sprint_state', { p_user: u, p_run: q.run })
          : db.rpc('challenge_dashboard', { p_user: u });
    const { data, error } = await call.abortSignal(AbortSignal.timeout(20000));
    return error ? failure(error) : json(data);
  });
}
export async function POST(request: Request) {
  return lessonRequest(request, true, async (u, db) => {
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return json({ error: 'Требуется JSON.' }, 415);
    let c;
    try {
      c = challengeCommand(JSON.parse(await readBodyText(request, 8192)));
    } catch {
      return json({ error: 'Некорректный запрос испытания.' }, 400);
    }
    const { data, error } = await db
      .rpc('challenge_command', { p_user: u, p_command: c })
      .abortSignal(AbortSignal.timeout(20000));
    return error ? failure(error) : json(data);
  });
}
