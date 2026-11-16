import { getSessionUser } from '@/lib/auth/session';
import { isAdmin } from '@/lib/admin/access';
import { createServiceClient } from '@/lib/supabase/service';
import { json } from '@/lib/lessons/http';
export async function GET(request: Request) {
  try {
    const user = await getSessionUser(request);
    if (!user) return json({ error: 'Войди через Telegram.' }, 401);
    if (!isAdmin(user, process.env.ADMIN_USER_IDS))
      return json({ error: 'Доступ только для администратора.' }, 403);
    if (new URL(request.url).search)
      return json({ error: 'Некорректные параметры.' }, 400);
    const { data, error } = await createServiceClient()
      .from('privacy_deletion_requests')
      .select('id,user_id,status,created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw Error();
    return json({ requests: data });
  } catch {
    return json({ error: 'Не удалось загрузить заявки.' }, 503);
  }
}
