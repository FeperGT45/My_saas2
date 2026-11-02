import 'server-only';
import { getSessionUser } from '@/lib/auth/session';
import { assertSameOrigin } from '@/lib/auth/security';
import { createServiceClient } from '@/lib/supabase/service';
import { AdminStorageError, dispatchAdmin } from './controller';
function storageError(error: { message: string; code?: string }) {
  if (
    /version conflict|request conflict/.test(error.message) ||
    error.code === '23505'
  )
    throw new AdminStorageError(
      409,
      'Запись изменилась или позиция/slug уже заняты. Обнови список и проверь поля.',
    );
  if (error.message.includes('empty publication'))
    throw new AdminStorageError(
      400,
      'Сначала добавь обычное задание и опубликуй урок. Пустой контент публиковать нельзя.',
    );
  if (
    /admin invalid|confirmation required/.test(error.message) ||
    ['23503', '23514', '22P02'].includes(error.code ?? '')
  )
    throw new AdminStorageError(
      400,
      'Проверь поля и выбранный раздел. Изменения не сохранены.',
    );
  throw new AdminStorageError(
    503,
    'Не удалось сохранить или загрузить данные. Проверь доступность базы и миграции.',
  );
}
export function adminRequest(request: Request) {
  return dispatchAdmin(request, {
    getUser: getSessionUser,
    adminIds: process.env.ADMIN_USER_IDS,
    assertOrigin: assertSameOrigin,
    read: async (q) => {
      const { data, error } = await createServiceClient().rpc('admin_read', {
        p_view: q.view,
        p_parent: q.parent,
        p_search: q.search,
        p_offset: q.offset,
      });
      if (error) storageError(error);
      return data;
    },
    save: async (actor, c) => {
      const { data, error } = await createServiceClient().rpc(
        'admin_save_content',
        {
          p_actor: actor,
          p_request: c.requestId,
          p_entity: c.entity,
          p_data: c.data,
          p_confirmation: c.confirmation,
        },
      );
      if (error) storageError(error);
      return data;
    },
  });
}
