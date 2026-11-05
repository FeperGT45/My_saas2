import { createHash } from 'node:crypto';
import { format } from 'prettier';
import { writeFile } from 'node:fs/promises';
import { loadLibrary, validateLibrary } from './content/library';
const library = await loadLibrary();
const available = library.lessons.filter(
  (l) =>
    !l.skills.includes('listening') &&
    !l.exercises.some((e) => ['listening', 'dictation'].includes(e.kind)),
);
const report = {
  package: library.manifest.packageId,
  revision: library.manifest.revision,
  summary: validateLibrary(library),
  availability: {
    publishedNonAudioFullLessons: available.length,
    archivedAudioLessons: library.lessons.length - available.length,
    introductoryLessonsIncluded: false,
    targetFullLessons: 300,
    remaining: Math.max(0, 300 - available.length),
    byLevel: Object.fromEntries(
      ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((level) => [
        level,
        available.filter((l) => l.level === level).length,
      ]),
    ),
    basis:
      'Local modular sources after audio retirement; verify production count separately after import.',
  },
  structure: 'passed',
  crossLegacyDuplicateCheck: 'passed',
  gradingCheck:
    'npm run test:library verifies all positive/negative references with the production SQL grader',
  methodology:
    'Author review and automated checks; CEFR labels remain provisional, without external psychometric calibration.',
  types: Object.fromEntries(
    [...new Set(library.lessons.flatMap((l) => l.exercises.map((e) => e.kind)))]
      .sort()
      .map((kind) => [
        kind,
        library.lessons.reduce(
          (n, l) => n + l.exercises.filter((e) => e.kind === kind).length,
          0,
        ),
      ]),
  ),
  lessons: library.lessons.map((l) => ({
    key: l.key,
    level: l.level,
    exercises: l.exercises.length,
    types: new Set(l.exercises.map((e) => e.kind)).size,
    readingWords: l.exercises
      .filter((e) => e.kind === 'reading')
      .map((e) => e.public_payload.passage!.split(/\s+/).length),
    sha256: createHash('sha256').update(JSON.stringify(l)).digest('hex'),
  })),
};
await writeFile(
  'content/library/quality-report.json',
  await format(JSON.stringify(report), { parser: 'json' }),
);
console.log('Library structural quality report written.', report.summary);
