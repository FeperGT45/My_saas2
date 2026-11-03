import { cefrLevels, type CefrLevel } from './types';
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export type PlacementCommand =
  | { action: 'start'; requestId: string }
  | { action: 'beginner' }
  | { action: 'route'; level: CefrLevel }
  | {
      action: 'answer';
      attemptId: string;
      questionId: string;
      requestId: string;
      option: string;
    };
export function placementCommand(raw: unknown): PlacementCommand {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    throw new Error('Ожидается объект данных.');
  const b = raw as Record<string, unknown>;
  const fields =
    b.action === 'start'
      ? ['action', 'requestId']
      : b.action === 'beginner'
        ? ['action']
        : b.action === 'route'
          ? ['action', 'level']
          : b.action === 'answer'
            ? ['action', 'attemptId', 'questionId', 'requestId', 'option']
            : [];
  if (!fields.length || Object.keys(b).some((k) => !fields.includes(k)))
    throw new Error('Некорректные поля запроса.');
  if (b.action === 'beginner') return { action: 'beginner' };
  if (b.action === 'route' && cefrLevels.includes(b.level as CefrLevel))
    return { action: 'route', level: b.level as CefrLevel };
  if (b.action === 'start' && uuid(b.requestId))
    return { action: 'start', requestId: b.requestId };
  if (
    b.action === 'answer' &&
    uuid(b.attemptId) &&
    uuid(b.questionId) &&
    uuid(b.requestId) &&
    typeof b.option === 'string' &&
    /^[a-d]$/.test(b.option)
  )
    return {
      action: 'answer',
      attemptId: b.attemptId,
      questionId: b.questionId,
      requestId: b.requestId,
      option: b.option,
    };
  throw new Error('Проверь параметры тестирования.');
}
