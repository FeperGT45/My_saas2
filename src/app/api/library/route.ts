import { adminClient } from '@/lib/auth/session';
import { json } from '@/lib/lessons/http';
export async function GET(request: Request) {
  if (new URL(request.url).search)
    return json({ error: 'Некорректные параметры библиотеки.' }, 400);
  try {
    const { data, error } = await adminClient()
      .rpc('curriculum_library')
      .abortSignal(AbortSignal.timeout(15000));
    if (error || !Array.isArray(data)) throw Error();
    return json(data);
  } catch {
    return json(
      {
        error:
          'Не удалось загрузить библиотеку. Проверь подключение и повтори попытку.',
      },
      503,
    );
  }
}
