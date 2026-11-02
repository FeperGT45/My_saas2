import { readBodyText } from '@/lib/auth/body';
import { lessonRequest, json } from '@/lib/lessons/http';
export async function POST(request: Request) {
  return lessonRequest(request, true, async (userId, db) => {
    let body;
    try {
      body = JSON.parse(await readBodyText(request, 1024));
    } catch {
      return json({ error: 'Некорректный часовой пояс.' }, 400);
    }
    if (
      typeof body?.timeZone !== 'string' ||
      body.timeZone.length > 80 ||
      Object.keys(body).some((k) => k !== 'timeZone')
    )
      return json({ error: 'Некорректный часовой пояс.' }, 400);
    const { error } = await db.rpc('set_game_timezone', {
      p_user: userId,
      p_zone: body.timeZone,
    });
    if (error)
      return json(
        {
          error: error.message.includes('locked')
            ? 'Часовой пояс уже закреплён после первого занятия.'
            : 'Не удалось сохранить часовой пояс.',
        },
        error.message.includes('locked') ? 409 : 400,
      );
    return json({ ok: true });
  });
}
