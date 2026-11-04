import { lessonRequest, json } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { requirePremiumFeature } from '@/lib/premium/server';
import { weeklyCommand } from '@/lib/learning/weekly';
import { refreshWeeklyPlan } from '@/lib/learning/weekly-server';
export async function POST(request: Request) {
  return lessonRequest(request, true, async (userId, db) => {
    const denied = await requirePremiumFeature(
      userId,
      db,
      'lesson_review_plan',
    );
    if (denied) return denied;
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return json({ error: 'Требуется JSON-запрос.' }, 415);
    let command;
    try {
      command = weeklyCommand(JSON.parse(await readBodyText(request, 1024)));
    } catch {
      return json(
        { error: 'Проверь цель, время занятий и дату переноса.' },
        400,
      );
    }
    try {
      return json(await refreshWeeklyPlan(userId, db, command));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('premium required'))
        return json(
          { error: 'Для календаря занятий нужен действующий Premium.' },
          403,
        );
      if (message.includes('level required'))
        return json(
          {
            error: 'Сначала определи уровень или выбери старт с нуля.',
            code: 'level_required',
          },
          409,
        );
      if (message.includes('conflict'))
        return json(
          {
            error:
              'План изменился в другой вкладке. Обнови его и повтори действие.',
          },
          409,
        );
      if (message.includes('invalid'))
        return json(
          {
            error:
              'Перенос возможен между будущими днями этой недели без выполненных заданий.',
          },
          400,
        );
      return json(
        {
          error:
            'Не удалось обновить календарь. Прогресс уроков сохранён. Повтори загрузку.',
        },
        503,
      );
    }
  });
}
