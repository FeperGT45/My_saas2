'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ArrowRight, Route, CheckCircle2, RotateCcw } from 'lucide-react';
import { Card } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useTelegram } from '@/features/telegram/provider';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import {
  learningGoals,
  type LearningGoal,
  type LearningPlan,
} from '@/lib/learning/recommend';
const skillNames = {
  grammar: 'Грамматика',
  vocabulary: 'Словарь',
  reading: 'Чтение',
  listening: 'Аудирование',
};
const reasons = {
  practice: 'Закрепляем ошибки',
  foundation: 'Укрепляем основу',
  advance: 'Следующий шаг сложности',
  goal: 'Под твою цель',
  continue: 'Продолжаем обучение',
};
export function LearningPlanLink() {
  return (
    <Link
      href="/learning-plan"
      className="border-primary/30 bg-primary/10 my-4 flex min-h-14 items-center gap-3 rounded-2xl border p-4 text-sm font-bold"
    >
      <Route className="shrink-0 text-teal-200" size={20} />
      Мой учебный план
      <ArrowRight className="ml-auto shrink-0" size={18} />
    </Link>
  );
}
export function LearningPanel() {
  const { account } = useTelegram();
  return <AccountLearningPanel key={account?.id ?? 'anonymous'} />;
}
function AccountLearningPanel() {
  const { account, status, authError } = useTelegram();
  const reduced = useReducedMotion();
  const [data, setData] = useState<LearningPlan | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [goal, setGoal] = useState<LearningGoal>('general');
  const [course, setCourse] = useState('');
  const [notice, setNotice] = useState('');
  const locked = useRef(false);
  useEffect(() => {
    if (account?.mode !== 'telegram') return;
    const controller = new AbortController();
    void fetchWithTimeout('/api/learning-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'refresh' }),
      signal: controller.signal,
    })
      .then(async (r) => {
        const body = await readJson(r);
        if (!r.ok) throw new Error(body.error ?? 'Учебный план недоступен.');
        if (!controller.signal.aborted) {
          setData(body);
          setGoal(body.goal);
          setCourse(body.courseId ?? '');
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Не удалось загрузить план.',
          );
      });
    return () => controller.abort();
  }, [account, revision]);
  async function save() {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fetchWithTimeout('/api/learning-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'preferences',
          goal,
          courseId: course || null,
        }),
      });
      const body = await readJson(r);
      if (!r.ok) throw new Error(body.error ?? 'Не удалось сохранить выбор.');
      setData(body);
      setGoal(body.goal);
      setCourse(body.courseId ?? '');
      setNotice('Цель и маршрут сохранены. Пройденные уроки остаются с тобой.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Не удалось обновить план.');
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  if (account?.mode !== 'telegram')
    return (
      <Card>
        <h2 className="font-bold">Твой план ждёт в Telegram</h2>
        <p role="status" className="text-muted-foreground mt-3 text-sm">
          {!account && status === 'telegram' && !authError
            ? 'Подключаем аккаунт…'
            : authError
              ? 'Не удалось проверить вход. Открой профиль и повтори авторизацию.'
              : 'Открой Voklumi через Telegram: план сохраняется в твоём аккаунте. Локальный режим не создаёт реальные результаты.'}
        </p>
        <Link
          href="/profile"
          className="text-primary mt-4 inline-flex min-h-11 items-center font-bold"
        >
          Проверить вход →
        </Link>
      </Card>
    );
  const courses = data?.courses ?? [];
  return (
    <div className="space-y-4">
      {error && (
        <Card>
          <p role="alert" className="text-sm text-rose-200">
            {error}
          </p>
          <Button
            variant="outline"
            className="mt-3"
            disabled={busy}
            onClick={() => {
              setData(null);
              setError('');
              setRevision((n) => n + 1);
            }}
          >
            Повторить загрузку плана
          </Button>
        </Card>
      )}
      {!data && !error && (
        <Card>
          <p role="status" className="animate-pulse text-sm">
            Подбираем следующие шаги…
          </p>
        </Card>
      )}
      {data && (
        <>
          <Card className="starfield border-primary/30">
            <Route className="text-teal-200" />
            <h2 className="mt-3 text-xl font-bold">Маршрут под твой ритм</h2>
            <p className="text-muted-foreground mt-2 text-sm">
              {data.level
                ? `Опорный уровень: ${data.level}. Сложность следующих шагов: ${data.targetLevel}.`
                : 'Сначала выбери стартовый уровень — тест или A1 для новичка.'}
            </p>
            <p className="text-muted-foreground mt-2 text-xs">
              Сложность плана — рекомендация для обучения, она не меняет
              предварительную оценку CEFR.
            </p>
            {!data.level && (
              <Link
                href="/placement"
                className="text-primary mt-4 inline-flex min-h-12 items-center font-bold"
              >
                Определить точку старта →
              </Link>
            )}
            {data.fallback && (
              <p className="mt-3 text-sm text-teal-200">
                Материалы уровня {data.targetLevel} пока не подходят по
                доступности или уже освоены. Предлагаем ближайшие доступные темы
                с учётом последовательности.
              </p>
            )}
            <p className="text-muted-foreground mt-3 text-xs">
              Освоено доступных уроков: {data.mastered} из {data.available}.
              Освоенные темы не назначаются заново без новых ошибок.
            </p>
          </Card>
          <Card>
            <h2 className="font-bold">Цель и выбор курса</h2>
            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void save();
              }}
            >
              <label className="block text-sm">
                Цель обучения
                <select
                  aria-label="Цель обучения"
                  value={goal}
                  onChange={(e) => setGoal(e.target.value as LearningGoal)}
                  disabled={busy}
                  className="bg-background border-border mt-2 min-h-12 w-full rounded-xl border px-3"
                >
                  {Object.entries(learningGoals).map(([key, label]) => (
                    <option key={key} value={key}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Курс
                <select
                  aria-label="Курс учебного плана"
                  value={course}
                  onChange={(e) => setCourse(e.target.value)}
                  disabled={busy}
                  className="bg-background border-border mt-2 min-h-12 w-full rounded-xl border px-3"
                >
                  <option value="">Подобрать автоматически</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title} · {c.level}
                    </option>
                  ))}
                </select>
              </label>
              <p className="text-muted-foreground text-xs">
                Можно выбрать другой доступный курс в любой момент. Если
                отдельного курса под цель ещё нет, план использует имеющиеся
                материалы.
              </p>
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Сохраняем…' : 'Сохранить учебный план'}
              </Button>
            </form>
            <p role="status" className="mt-3 text-sm text-teal-200">
              {notice}
            </p>
          </Card>
          {!!data.skills.length && (
            <Card>
              <h2 className="font-bold">Что закрепить</h2>
              <div className="mt-3 space-y-3">
                {data.skills.map((s) => (
                  <div key={s.skill}>
                    <p className="text-sm font-semibold">
                      {skillNames[s.skill]} ·{' '}
                      {s.weak ? 'Нужно закрепить' : 'Продолжай практику'}
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      {s.correct} из {s.answered} верно ·{' '}
                      {s.source === 'lessons'
                        ? 'последние завершённые уроки'
                        : 'последний тест уровня'}
                    </p>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground mt-4 text-xs">
                Это статистика проверенных заданий, а не отдельный уровень
                владения навыком.
              </p>
            </Card>
          )}
          {data.level && !data.items.length && (
            <Card>
              <CheckCircle2 className="text-teal-200" />
              <h2 className="mt-3 font-bold">Следующие шаги пока не найдены</h2>
              <p className="text-muted-foreground mt-2 text-sm">
                Доступные темы могут быть освоены или требовать других
                материалов. Выбери автоматический подбор либо другой курс.
                Пройденные уроки можно повторить по желанию.
              </p>
              <div className="mt-3 space-y-2">
                {data.optionalReview.map((l) => (
                  <Link
                    key={l.id}
                    href={`/lesson?lesson=${l.id}`}
                    className="text-primary flex min-h-11 items-center text-sm"
                  >
                    Повторить по желанию: {l.title} →
                  </Link>
                ))}
              </div>
              <Link
                href="/courses"
                className="text-primary mt-3 inline-flex min-h-11 items-center"
              >
                Открыть каталог →
              </Link>
            </Card>
          )}
          {!!data.items.length && (
            <section aria-label="Рекомендуемые уроки" className="space-y-3">
              <h2 className="text-lg font-bold">
                Ближайшие шаги · {data.items.length}
              </h2>
              {data.items.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{
                    delay: reduced ? 0 : Math.min(index * 0.04, 0.2),
                  }}
                >
                  <Card>
                    <div className="flex gap-3">
                      <span className="bg-primary/15 text-primary flex size-10 shrink-0 items-center justify-center rounded-xl font-bold">
                        {item.reason === 'practice' ? (
                          <RotateCcw size={18} />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-xs text-teal-200">
                          {reasons[item.reason]} · {item.level}
                        </p>
                        <h3 className="mt-1 font-bold">{item.title}</h3>
                        <p className="text-muted-foreground mt-1 text-xs">
                          {item.courseTitle} · {item.unitTitle}
                        </p>
                      </div>
                    </div>
                    {item.ready ? (
                      <Link
                        href={`/lesson?lesson=${item.id}`}
                        className="bg-primary text-primary-foreground mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl border-b-4 border-[#6850ad] px-4 text-sm font-bold"
                      >
                        {item.reason === 'practice'
                          ? 'Закрепить тему'
                          : 'Начать урок'}
                        <ArrowRight size={16} />
                      </Link>
                    ) : (
                      <p className="text-muted-foreground mt-3 text-xs">
                        Следующий шаг: сначала заверши предыдущие уроки этого
                        курса с результатом от 60%.
                      </p>
                    )}
                  </Card>
                </motion.div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
