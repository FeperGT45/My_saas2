import { deletionTicket } from '@/lib/privacy/ticket';
import { lessonRequest, json, isUuid } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    if (new URL(request.url).search)
      return json({ error: 'Параметры не поддерживаются.' }, 400);
    const { data, error } = await db
      .from('privacy_deletion_requests')
      .select('id,status,created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      return json(
        {
          error:
            'Не удалось загрузить заявку. Попробуй позже или напиши в поддержку.',
        },
        503,
      );
    }
    return json({ request: data ? deletionTicket(data) : null });
  });
}
export async function POST(request: Request) {
  return lessonRequest(request, true, async (userId, db) => {
    let body;
    try {
      body = JSON.parse(await readBodyText(request, 1024));
    } catch {
      return json({ error: 'Некорректный запрос.' }, 400);
    }
    if (
      !isUuid(body?.requestId) ||
      body.confirm !== true ||
      Object.keys(body).some((k) => !['requestId', 'confirm'].includes(k))
    )
      return json({ error: 'Подтверди запрос на удаление.' }, 400);
    const { data, error } = await db.rpc('request_account_deletion', {
      p_user: userId,
      p_request: body.requestId,
    });
    if (error) {
      return json(
        {
          error:
            'Не удалось сохранить заявку. Повтори запрос или напиши в поддержку.',
        },
        503,
      );
    }
    return json({ request: deletionTicket(data) });
  });
}
