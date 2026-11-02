import { lessonRequest, json } from '@/lib/lessons/http';
import { telegramInviteUrl } from '@/lib/social/invite';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    const url = new URL(request.url),
      scope = url.searchParams.get('scope') ?? 'weekly',
      raw = url.searchParams.get('offset') ?? '0';
    if (
      !['weekly', 'global'].includes(scope) ||
      !/^\d{1,5}$/.test(raw) ||
      Number(raw) > 10000
    )
      return json({ error: 'Некорректный запрос рейтинга.' }, 400);
    const { data, error } = await db.rpc('social_summary', {
      p_user: userId,
      p_scope: scope,
      p_offset: Number(raw),
    });
    if (error) return json({ error: 'Не удалось загрузить рейтинг.' }, 503);
    const { code, ...stats } = data.invitations;
    return json({
      ...data,
      invitations: {
        ...stats,
        url: telegramInviteUrl(
          code,
          process.env.TELEGRAM_BOT_USERNAME ?? 'Voklumi_bot',
          process.env.TELEGRAM_MINI_APP_SLUG,
        ),
      },
    });
  });
}
