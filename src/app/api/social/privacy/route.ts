import { lessonRequest, json } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
export async function POST(request: Request) {
  return lessonRequest(request, true, async (userId, db) => {
    let body;
    try {
      body = JSON.parse(await readBodyText(request, 1024));
    } catch {
      return json({ error: 'Некорректные настройки.' }, 400);
    }
    if (
      typeof body?.visible !== 'boolean' ||
      typeof body.alias !== 'string' ||
      body.alias.trim().length < 2 ||
      body.alias.trim().length > 32 ||
      /[\u0000-\u001f\u007f@/:]/.test(body.alias) ||
      Object.keys(body).some((k) => !['visible', 'alias'].includes(k))
    )
      return json(
        {
          error: 'Укажи псевдоним от 2 до 32 символов без ссылок и контактов.',
        },
        400,
      );
    const { error } = await db.rpc('set_social_privacy', {
      p_user: userId,
      p_visible: body.visible,
      p_alias: body.alias,
    });
    return error
      ? json({ error: 'Не удалось сохранить приватность.' }, 400)
      : json({ ok: true });
  });
}
