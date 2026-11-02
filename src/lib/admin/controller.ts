import type { SessionUser } from '@/lib/auth/session';
import { readBodyText } from '@/lib/auth/body';
import { isAdmin } from './access';
import {
  AdminValidationError,
  parseAdminCommand,
  parseAdminQuery,
  type AdminCommand,
} from './validation';
export type AdminDependencies = {
  getUser: (request: Request) => Promise<SessionUser | null>;
  adminIds: string | undefined;
  assertOrigin: (request: Request) => void;
  read: (query: ReturnType<typeof parseAdminQuery>) => Promise<unknown>;
  save: (actor: string, command: AdminCommand) => Promise<unknown>;
};
export class AdminStorageError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      Vary: 'Cookie',
      'X-Content-Type-Options': 'nosniff',
    },
  });
export async function dispatchAdmin(request: Request, deps: AdminDependencies) {
  try {
    if (request.method !== 'GET' && request.method !== 'POST')
      return json({ error: 'Метод не поддерживается.' }, 405);
    if (request.method === 'POST') {
      try {
        deps.assertOrigin(request);
      } catch {
        return json({ error: 'Недопустимый источник запроса.' }, 403);
      }
    }
    const user = await deps.getUser(request);
    if (!user)
      return json({ error: 'Войди через Telegram для доступа к панели.' }, 401);
    if (!isAdmin(user, deps.adminIds))
      return json(
        { error: 'Недостаточно прав. Доступ разрешён только администратору.' },
        403,
      );
    if (request.method === 'GET')
      return json(await deps.read(parseAdminQuery(request.url)));
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return json({ error: 'Требуется JSON-запрос.' }, 415);
    let raw: string;
    try {
      raw = await readBodyText(request, 32768);
    } catch {
      return json({ error: 'Запрос повреждён или превышает 32 КБ.' }, 413);
    }
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'Некорректный JSON.' }, 400);
    }
    return json(await deps.save(user!.id, parseAdminCommand(body)));
  } catch (error) {
    if (error instanceof AdminValidationError)
      return json({ error: error.message }, 400);
    if (error instanceof AdminStorageError)
      return json({ error: error.message }, error.status);
    return json(
      { error: 'Административный сервис недоступен. Повтори запрос позже.' },
      503,
    );
  }
}
