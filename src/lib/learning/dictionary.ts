export type DictionaryWord = {
  id: string | null;
  key: string;
  front: string;
  back: string;
  example: string;
  collectionId: string | null;
  version: number;
  dueAt: string | null;
  imported: boolean;
};
export type DictionaryCollection = {
  id: string;
  title: string;
  version: number;
  words: number;
};
export type DictionaryData = {
  version: 'dictionary-v1';
  source: 'own' | 'lessons';
  offset: number;
  total: number;
  canManage: boolean;
  canTrain: boolean;
  words: DictionaryWord[];
  collections: DictionaryCollection[];
  statistics: {
    total: number;
    due: number;
    reviewed: number;
    established: number;
    known: number;
    repeats: number;
  } | null;
};
export type DictionaryCard = {
  id: string;
  key: string;
  front: string;
  back: string;
  example: string;
  version: number;
};
export type DictionaryQueue = {
  cards: DictionaryCard[];
  nextDue: string | null;
};
const uuid = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
const key = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{32}$/.test(v);
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v))
    throw Error('invalid dictionary command');
  return v as Record<string, unknown>;
};
const fields = (v: Record<string, unknown>, names: string) => {
  if (Object.keys(v).sort().join(',') !== names.split(',').sort().join(','))
    throw Error('invalid dictionary fields');
};
const version = (v: unknown) => Number.isInteger(v) && Number(v) >= 0;
const text = (v: unknown, min: number, max: number) =>
  typeof v === 'string' &&
  v.trim().length >= min &&
  v.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);
export function dictionaryQuery(params: URLSearchParams) {
  if (
    [...params.keys()].some(
      (k) =>
        !['source', 'collection', 'search', 'offset'].includes(k) ||
        params.getAll(k).length !== 1,
    )
  )
    throw Error('invalid dictionary query');
  const source = params.get('source') ?? 'own',
    collection = params.get('collection') || null,
    search = (params.get('search') ?? '').trim(),
    offset = params.get('offset') ?? '0';
  if (
    !['own', 'lessons'].includes(source) ||
    (collection !== null && (!uuid(collection) || source !== 'own')) ||
    search.length > 200 ||
    !/^\d{1,6}$/.test(offset) ||
    Number(offset) > 100000
  )
    throw Error('invalid dictionary query');
  return { source, collection, search, offset: Number(offset) };
}
export function dictionaryCommand(value: unknown) {
  const v = object(value);
  if (v.action === 'train') {
    fields(v, 'action,collectionId');
    if (v.collectionId !== null && !uuid(v.collectionId)) throw Error();
    return v;
  }
  if (v.action === 'answer') {
    fields(v, 'action,id,requestId,key,version,rating');
    if (
      !uuid(v.id) ||
      !uuid(v.requestId) ||
      !key(v.key) ||
      !version(v.version) ||
      ![0, 4].includes(Number(v.rating)) ||
      typeof v.rating !== 'number'
    )
      throw Error();
    return v;
  }
  fields(v, 'action,requestId,data');
  if (!uuid(v.requestId)) throw Error();
  const d = object(v.data);
  if (v.action === 'save_word') {
    fields(d, 'id,version,front,back,example,collectionId');
    if (
      (d.id !== null && !uuid(d.id)) ||
      !version(d.version) ||
      !text(d.front, 1, 200) ||
      !/[A-Za-z]/.test(d.front as string) ||
      !text(d.back, 1, 200) ||
      !text(d.example, 0, 2000) ||
      (d.collectionId !== null && !uuid(d.collectionId))
    )
      throw Error();
  } else if (v.action === 'save_collection') {
    fields(d, 'id,version,title');
    if (
      (d.id !== null && !uuid(d.id)) ||
      !version(d.version) ||
      !text(d.title, 1, 80)
    )
      throw Error();
  } else if (v.action === 'delete_word' || v.action === 'delete_collection') {
    fields(d, 'id,version');
    if (!uuid(d.id) || !version(d.version)) throw Error();
  } else if (v.action === 'import') {
    fields(d, 'key,collectionId');
    if (!key(d.key) || (d.collectionId !== null && !uuid(d.collectionId)))
      throw Error();
  } else throw Error();
  return v;
}
