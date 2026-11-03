import { lessonRequest, json } from '@/lib/lessons/http';
import { readBodyText } from '@/lib/auth/body';
import { learningCommand } from '@/lib/learning/validation';
import { buildLearningPath } from '@/lib/learning/server';
export async function GET(request: Request) {
  return lessonRequest(request, false, async (userId, db) => {
    if (new URL(request.url).search)
      return json({ error: 'Некорректные параметры маршрута.' }, 400);
    return json(await buildLearningPath(userId, db, false));
  });
}
export async function POST(request: Request) {
  return lessonRequest(request, true, async (userId, db) => {
    if (
      !request.headers
        .get('content-type')
        ?.toLowerCase()
        .startsWith('application/json')
    )
      return json({ error: 'Требуется JSON-запрос.' }, 415);
    let command;
    try {
      command = learningCommand(JSON.parse(await readBodyText(request, 1024)));
    } catch {
      return json({ error: 'Некорректные настройки учебного плана.' }, 400);
    }
    if (command.action === 'preferences') {
      const { error } = await db.rpc('learning_path_preferences', {
        p_user: userId,
        p_goal: command.goal,
        p_course: command.courseId,
      });
      if (error)
        return json(
          {
            error:
              'Не удалось выбрать цель или курс. Обнови список доступных материалов.',
          },
          400,
        );
    }
    try {
      return json(await buildLearningPath(userId, db, true));
    } catch {
      return json(
        {
          error:
            'Не удалось обновить учебный план. Повтори загрузку: результаты уроков сохранены.',
        },
        503,
      );
    }
  });
}
