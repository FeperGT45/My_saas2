/** Local UI fixtures only. No API, auth identity or persistent progress. */
export const demoPlayer = {
  name: 'Алекс',
  initials: 'АЛ',
  xp: 1240,
  streak: 7,
  level: 4,
  weeklyXp: 340,
};
export const demoCourses = [
  {
    id: 'en',
    flag: '🇬🇧',
    name: 'Английский',
    subtitle: 'Открой мир без перевода',
    level: 'A1 → B2',
    lessons: 48,
    progress: 32,
    available: true,
    color: 'purple',
  },
  {
    id: 'es',
    flag: '🇪🇸',
    name: 'Испанский',
    subtitle: 'Больше солнца в каждом слове',
    level: 'A1 → B1',
    lessons: 36,
    progress: 0,
    available: false,
    color: 'teal',
  },
  {
    id: 'fr',
    flag: '🇫🇷',
    name: 'Французский',
    subtitle: 'Твой новый язык вдохновения',
    level: 'A1 → B1',
    lessons: 32,
    progress: 0,
    available: false,
    color: 'blue',
  },
];
export const demoLessons = [
  {
    id: 1,
    title: 'Привет, мир!',
    subtitle: 'Знакомство и приветствия',
    state: 'done',
  },
  {
    id: 2,
    title: 'Это про меня',
    subtitle: 'Расскажи немного о себе',
    state: 'done',
  },
  {
    id: 3,
    title: 'На одной волне',
    subtitle: 'Слова, которые сближают',
    state: 'current',
  },
  {
    id: 4,
    title: 'Мой маленький мир',
    subtitle: 'Дом и любимые вещи',
    state: 'locked',
  },
  {
    id: 5,
    title: 'Большое приключение',
    subtitle: 'Повторение модуля',
    state: 'locked',
  },
] as const;
export const demoQuestions = [
  {
    prompt: 'Привет!',
    hint: 'Выбери перевод на английский',
    options: ['Goodbye', 'Hello', 'Thanks', 'Sorry'],
    answer: 'Hello',
    explanation: 'Hello — универсальное приветствие при знакомстве.',
  },
  {
    prompt: 'Спасибо',
    hint: 'Как поблагодарить собеседника?',
    options: ['Please', 'Hello', 'Thank you', 'Good night'],
    answer: 'Thank you',
    explanation: 'Thank you — вежливый способ сказать «спасибо».',
  },
  {
    prompt: 'Рад знакомству',
    hint: 'Заверши ваше первое знакомство',
    options: ['See you', 'Nice to meet you', 'Excuse me', 'Good morning'],
    answer: 'Nice to meet you',
    explanation: 'Nice to meet you говорят при первой встрече.',
  },
];
export const demoRanking = [
  { name: 'Мия', initials: 'МИ', xp: 1820, color: 'purple' },
  { name: 'Марк', initials: 'МА', xp: 1650, color: 'teal' },
  { name: 'Соня', initials: 'СО', xp: 1480, color: 'blue' },
  { name: 'Алекс', initials: 'АЛ', xp: 1240, color: 'purple' },
  { name: 'Даня', initials: 'ДА', xp: 1180, color: 'teal' },
];
export const demoAchievements = [
  {
    title: 'Первый контакт',
    text: 'Пройди первый урок',
    icon: 'rocket',
    unlocked: true,
  },
  {
    title: 'В ударе',
    text: 'Занимайся 7 дней подряд',
    icon: 'flame',
    unlocked: true,
  },
  {
    title: 'Искра знаний',
    text: 'Набери 1 000 XP',
    icon: 'zap',
    unlocked: true,
  },
  {
    title: 'Без промаха',
    text: 'Пройди 10 уроков без ошибок',
    icon: 'target',
    unlocked: false,
  },
  {
    title: 'Среди звёзд',
    text: 'Попади в тройку лидеров',
    icon: 'trophy',
    unlocked: false,
  },
  {
    title: 'Исследователь',
    text: 'Заверши первый курс',
    icon: 'planet',
    unlocked: false,
  },
];
