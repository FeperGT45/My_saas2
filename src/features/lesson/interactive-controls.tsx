'use client';
import {
  ExerciseControls as LegacyControls,
  answerReady as legacyReady,
  AudioPrompt,
} from './exercise-controls';
import { cn } from '@/lib/utils';
import { Card } from '@/components/ui/game';
import type { Answer, Exercise, Kind } from './types';
type Props = {
  exercise: Exercise;
  answer: Answer;
  onChange: (answer: Answer) => void;
  disabled: boolean;
};
const optionClass =
  'border-border bg-card flex min-h-14 w-full items-center gap-3 rounded-2xl border-2 border-b-4 px-4 py-3 text-left text-sm font-semibold';
export function MultipleChoiceExercise({
  exercise,
  answer,
  onChange,
  disabled,
}: Props) {
  const selected = Array.isArray(answer) ? answer : [];
  return (
    <fieldset>
      <legend className="text-muted-foreground mb-3 text-sm">
        Выбери все правильные варианты
      </legend>
      <div className="space-y-3">
        {exercise.payload.options?.map((o) => (
          <label
            key={o.id}
            className={cn(
              optionClass,
              selected.includes(o.id) && 'border-primary bg-primary/10',
            )}
          >
            <input
              type="checkbox"
              disabled={disabled}
              checked={selected.includes(o.id)}
              onChange={() =>
                onChange(
                  selected.includes(o.id)
                    ? selected.filter((id) => id !== o.id)
                    : [...selected, o.id],
                )
              }
              className="size-5 shrink-0 accent-purple-400"
            />
            {o.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
export function OpenAnswerExercise({
  exercise,
  answer,
  onChange,
  disabled,
}: Props) {
  const p = exercise.payload;
  const label =
    exercise.kind === 'translation'
      ? 'Твой перевод'
      : exercise.kind === 'dictation'
        ? 'Запиши услышанную фразу'
        : 'Исправленное предложение';
  return (
    <div>
      {exercise.kind === 'dictation' ? (
        <AudioPrompt text={p.text!} lang={p.lang ?? 'en-US'} />
      ) : (
        <Card className="mb-4">
          <p
            lang={exercise.kind === 'translation' ? 'ru' : 'en'}
            className="text-lg font-semibold"
          >
            {exercise.kind === 'translation' ? p.source : p.sentence}
          </p>
        </Card>
      )}
      <label className="block text-sm font-semibold">
        {label}
        <textarea
          lang="en"
          rows={3}
          value={typeof answer === 'string' ? answer : ''}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          maxLength={1000}
          autoCapitalize="none"
          autoComplete="off"
          spellCheck={false}
          className="border-border bg-card focus:border-primary mt-2 w-full resize-y rounded-2xl border-2 p-4 text-base"
        />
      </label>
      <p className="text-muted-foreground mt-3 text-xs">
        Проверяются допустимые авторские формулировки. Регистр, лишние пробелы и
        некоторые сокращения учитываются автоматически.
      </p>
    </div>
  );
}
export function TranslationExercise(p: Props) {
  return <OpenAnswerExercise {...p} />;
}
export function CorrectionExercise(p: Props) {
  return <OpenAnswerExercise {...p} />;
}
export function DictationExercise(p: Props) {
  return <OpenAnswerExercise {...p} />;
}
export function WordOrderExercise(p: Props) {
  return <LegacyControls {...p} />;
}
export function SpellingExercise(p: Props) {
  return <LegacyControls {...p} />;
}
function ContextChoices(p: Props) {
  const payload = p.exercise.payload;
  return (
    <>
      <Card className="mb-4">
        <p
          lang="en"
          className="text-lg leading-relaxed font-semibold break-words"
        >
          {payload.sentence ?? payload.context ?? payload.word}
        </p>
        {payload.relation && (
          <p className="text-muted-foreground mt-2 text-xs">
            {payload.relation === 'synonym'
              ? 'Найди слово с близким значением'
              : 'Найди слово с противоположным значением'}
          </p>
        )}
      </Card>
      <LegacyControls {...p} />
    </>
  );
}
export function ErrorIdentificationExercise(p: Props) {
  return <ContextChoices {...p} />;
}
export function ContextChoiceExercise(p: Props) {
  return <ContextChoices {...p} />;
}
export function ResponseChoiceExercise(p: Props) {
  return <ContextChoices {...p} />;
}
export function TensesExercise(p: Props) {
  return <ContextChoices {...p} />;
}
export function SynonymAntonymExercise(p: Props) {
  return <ContextChoices {...p} />;
}
export function WordReviewExercise(p: Props) {
  return <ContextChoices {...p} />;
}
export function ReadingExercise(p: Props) {
  return (
    <>
      <Card className="mb-4">
        <h2 className="eyebrow mb-3">Прочитай текст</h2>
        <p
          lang="en"
          className="text-base leading-relaxed break-words whitespace-pre-line"
        >
          {p.exercise.payload.passage}
        </p>
      </Card>
      <LegacyControls {...p} />
    </>
  );
}
export function DialogueExercise(p: Props) {
  return (
    <>
      <section aria-label="Диалог" className="mb-5 space-y-3">
        {p.exercise.payload.lines?.map((line, i) => (
          <div
            key={i}
            className={cn(
              'bg-card border-border max-w-[95%] rounded-2xl border p-4',
              i % 2 === 1 && 'bg-primary/10 ml-auto',
            )}
          >
            <p className="text-xs font-bold text-teal-200">{line.speaker}</p>
            <p lang="en" className="mt-1 text-sm leading-relaxed">
              {line.text}
            </p>
          </div>
        ))}
      </section>
      <LegacyControls {...p} />
    </>
  );
}
export function UnitTestExercise({
  exercise,
  answer,
  onChange,
  disabled,
}: Props) {
  const selected =
    typeof answer === 'object' && !Array.isArray(answer) ? answer : {};
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground text-xs">
        Ответь на все вопросы. Блок засчитывается, если верны все ответы; после
        проверки появится разбор каждого.
      </p>
      {exercise.payload.questions?.map((q, i) => (
        <fieldset key={q.id} className="border-border rounded-2xl border p-3">
          <legend className="px-2 text-sm font-bold">
            {i + 1}. {q.prompt}
          </legend>
          <div className="mt-2 space-y-2">
            {q.options.map((o) => (
              <button
                type="button"
                key={o.id}
                disabled={disabled}
                aria-pressed={selected[q.id] === o.id}
                className={cn(
                  optionClass,
                  selected[q.id] === o.id && 'border-primary bg-primary/10',
                )}
                onClick={() => onChange({ ...selected, [q.id]: o.id })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
// Every format has a reusable component; shared interaction primitives keep behavior consistent.
const controls: Record<Kind, (p: Props) => React.JSX.Element> = {
  single_choice: LegacyControls,
  multiple_choice: MultipleChoiceExercise,
  sentence: LegacyControls,
  translation: TranslationExercise,
  gap: LegacyControls,
  matching: LegacyControls,
  word_order: WordOrderExercise,
  error_identification: ErrorIdentificationExercise,
  correction: CorrectionExercise,
  context_choice: ContextChoiceExercise,
  listening: LegacyControls,
  dictation: DictationExercise,
  reading: ReadingExercise,
  dialogue: DialogueExercise,
  response_choice: ResponseChoiceExercise,
  spelling: SpellingExercise,
  tenses: TensesExercise,
  synonym_antonym: SynonymAntonymExercise,
  word_review: WordReviewExercise,
  unit_test: UnitTestExercise,
  grammar: LegacyControls,
};
export function ExerciseControls(props: Props) {
  const Component = controls[props.exercise.kind];
  return <Component {...props} />;
}
export function answerReady(exercise: Exercise, answer: Answer) {
  if (exercise.kind === 'unit_test')
    return (
      typeof answer === 'object' &&
      !Array.isArray(answer) &&
      exercise.payload.questions?.every((q) =>
        q.options.some((o) => o.id === answer[q.id]),
      )
    );
  if (exercise.kind === 'multiple_choice')
    return Array.isArray(answer) && answer.length > 0;
  if (['word_order', 'spelling'].includes(exercise.kind))
    return (
      Array.isArray(answer) && answer.length === exercise.payload.tokens?.length
    );
  return legacyReady(exercise, answer);
}
