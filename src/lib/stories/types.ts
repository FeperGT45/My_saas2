export type StoryChoice = {
  id: string;
  text: string;
  next: string;
  correct?: boolean;
};
export type StoryNode = {
  speaker: string;
  text: string;
  vocabulary: { word: string; translation: string }[];
  grammar?: string;
  question?: string;
  explanation?: string;
  choices: StoryChoice[];
  ending?: { title: string; reward: string };
};
export type StoryDocument = { start: string; nodes: Record<string, StoryNode> };
export type StorySource = {
  slug: string;
  revision: number;
  title: string;
  subtitle: string;
  description: string;
  level: 'A1' | 'A2' | 'B1' | 'B2';
  minutes: number;
  free_preview: boolean;
  published: boolean;
  document: StoryDocument;
};
export type StoryCard = Omit<
  StorySource,
  'document' | 'published' | 'free_preview'
> & {
  free: boolean;
  accessible: boolean;
  nodes: number;
  endings: number;
  activeId: string | null;
  completed: number;
};
export type StoryEnding = {
  slug: string;
  revision: number;
  ending: string;
  title: string;
  reward: string;
  obtainedAt: string;
  storyTitle: string;
};
export type StoryCatalog = { stories: StoryCard[]; endings: StoryEnding[] };
export type StoryState = {
  id: string;
  slug: string;
  revision: number;
  title: string;
  level: string;
  version: number;
  status: 'active' | 'completed' | 'abandoned';
  accessible: boolean;
  nodeId: string;
  visited: number;
  totalNodes: number;
  node:
    | (Omit<StoryNode, 'choices' | 'explanation'> & {
        choices: { id: string; text: string }[];
      })
    | null;
  transcript: { speaker: string; text: string; choice: string }[];
  answered: number;
  correct: number;
  reward: string | null;
  newEnding: boolean;
  feedback: { correct: boolean; explanation: string } | null;
};

const slug = (v: unknown): v is string =>
  typeof v === 'string' && /^[a-z][a-z0-9-]{0,79}$/.test(v);
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
export function storyCommand(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw Error('invalid command');
  const b = input as Record<string, unknown>;
  const exact = (keys: string[]) =>
    Object.keys(b).sort().join() === keys.sort().join();
  if (
    b.action === 'start' &&
    exact(['action', 'slug', 'requestId']) &&
    slug(b.slug) &&
    uuid(b.requestId)
  )
    return { action: 'start' as const, slug: b.slug, requestId: b.requestId };
  if (
    b.action === 'choose' &&
    exact(['action', 'attemptId', 'requestId', 'version', 'choiceId']) &&
    uuid(b.attemptId) &&
    uuid(b.requestId) &&
    Number.isInteger(b.version) &&
    Number(b.version) >= 0 &&
    slug(b.choiceId)
  )
    return {
      action: 'choose' as const,
      attemptId: b.attemptId,
      requestId: b.requestId,
      version: Number(b.version),
      choiceId: b.choiceId,
    };
  throw Error('invalid command');
}
export function storyAttemptParam(query: URLSearchParams) {
  if (
    [...query.keys()].some((k) => k !== 'attempt') ||
    query.getAll('attempt').length > 1
  )
    throw Error('invalid query');
  const id = query.get('attempt');
  if (id !== null && !uuid(id)) throw Error('invalid query');
  return id;
}

// Content is trusted editorial input, but graph mistakes must fail before import.
export function validateStory(s: StorySource): void {
  const text = (v: unknown, min: number, max: number) =>
    typeof v === 'string' && v.trim().length >= min && v.length <= max;
  if (
    !slug(s.slug) ||
    !Number.isInteger(s.revision) ||
    s.revision < 1 ||
    !text(s.title, 3, 120) ||
    !text(s.subtitle, 3, 120) ||
    !text(s.description, 30, 500) ||
    !['A1', 'A2', 'B1', 'B2'].includes(s.level) ||
    !Number.isInteger(s.minutes) ||
    s.minutes < 5 ||
    s.minutes > 60 ||
    typeof s.free_preview !== 'boolean' ||
    typeof s.published !== 'boolean'
  )
    throw Error('invalid story metadata');
  const nodes = s.document?.nodes,
    ids = Object.keys(nodes ?? {});
  if (ids.length < 15 || ids.length > 80 || !ids.includes(s.document.start))
    throw Error('invalid story graph size/start');
  let endings = 0,
    tasks = 0,
    branches = 0;
  for (const id of ids) {
    const n = nodes[id];
    if (
      !slug(id) ||
      !text(n.speaker, 1, 80) ||
      !text(n.text, 40, 4000) ||
      !Array.isArray(n.vocabulary) ||
      n.vocabulary.length > 12 ||
      n.vocabulary.some(
        (v) => !text(v.word, 1, 100) || !text(v.translation, 1, 200),
      ) ||
      (n.grammar !== undefined && !text(n.grammar, 10, 1500)) ||
      !Array.isArray(n.choices)
    )
      throw Error('invalid story node: ' + id);
    if (n.ending) {
      endings++;
      if (
        n.choices.length ||
        n.question ||
        !text(n.ending.title, 3, 100) ||
        !text(n.ending.reward, 3, 100)
      )
        throw Error('invalid ending');
    } else if (n.choices.length < 1 || n.choices.length > 4)
      throw Error('invalid choices');
    if (n.choices.length > 1) branches++;
    if (new Set(n.choices.map((c) => c.id)).size !== n.choices.length)
      throw Error('duplicate choice');
    for (const c of n.choices)
      if (
        !slug(c.id) ||
        !text(c.text, 1, 300) ||
        !ids.includes(c.next) ||
        (c.correct !== undefined && typeof c.correct !== 'boolean')
      )
        throw Error('invalid transition');
    if (n.question) {
      tasks++;
      if (
        !text(n.question, 5, 300) ||
        !text(n.explanation, 10, 1500) ||
        n.choices.some((c) => typeof c.correct !== 'boolean') ||
        !n.choices.some((c) => c.correct) ||
        !n.choices.some((c) => !c.correct)
      )
        throw Error('invalid exercise');
    } else if (n.choices.some((c) => c.correct !== undefined))
      throw Error('grading without exercise');
  }
  if (endings < 2 || tasks < 2 || branches < 3)
    throw Error('insufficient story variety');
  const seen = new Set<string>(),
    visiting = new Set<string>();
  function walk(id: string) {
    if (visiting.has(id)) throw Error('story cycle');
    if (seen.has(id)) return;
    visiting.add(id);
    nodes[id].choices.forEach((c) => walk(c.next));
    visiting.delete(id);
    seen.add(id);
  }
  walk(s.document.start);
  if (seen.size !== ids.length) throw Error('unreachable story node');
}
