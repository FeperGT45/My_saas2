import { readFile } from 'node:fs/promises';
export const levels = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
export const categories = ['grammar', 'vocabulary', 'reading'];
export async function loadPlacementBank() {
  const bank = JSON.parse(
    await readFile(
      new URL('../../content/placement-en-ru.v1.json', import.meta.url),
      'utf8',
    ),
  );
  validatePlacementBank(bank);
  return bank;
}
export function validatePlacementBank(bank) {
  if (
    bank.version !== 'placement-en-ru-v1' ||
    bank.language !== 'en' ||
    !Array.isArray(bank.questions) ||
    bank.questions.length < 120
  )
    throw new Error('Invalid placement bank');
  const codes = new Set();
  const prompts = new Set();
  for (const q of bank.questions) {
    if (
      codes.has(q.code) ||
      prompts.has(q.prompt) ||
      !levels.includes(q.level) ||
      !categories.includes(q.category) ||
      !/[а-яё]/i.test(q.prompt) ||
      !/[а-яё]/i.test(q.explanation) ||
      !q.topic ||
      q.options.length !== 4 ||
      new Set(q.options.map((o) => o.id)).size !== 4 ||
      new Set(q.options.map((o) => o.label)).size !== 4 ||
      !q.options.some((o) => o.id === q.correctOption) ||
      q.options.some((o) => !o.label.trim()) ||
      (q.category === 'reading' && (!q.passage || q.passage.length < 20))
    )
      throw new Error('Invalid placement question: ' + q.code);
    codes.add(q.code);
    prompts.add(q.prompt);
  }
  for (const level of levels) {
    const rows = bank.questions.filter((q) => q.level === level);
    if (
      rows.length < 20 ||
      categories.some((c) => rows.filter((q) => q.category === c).length < 6)
    )
      throw new Error('Incomplete level: ' + level);
  }
  return bank;
}
export function placementSeedSql(bank) {
  const json = JSON.stringify(bank);
  if (json.includes('$placement_bank$'))
    throw new Error('Invalid SQL delimiter in content');
  return `-- Generated from content/placement-en-ru.v1.json; server-side data, never a browser asset.\nSELECT public.placement_import_questions($placement_bank$${json}$placement_bank$::jsonb);\n`;
}
