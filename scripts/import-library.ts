import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import {
  loadLibrary,
  libraryPayload,
  validateLibrary,
} from './content/library';
import { readServiceConfiguration } from '../src/lib/supabase/config';
try {
  const library = await loadLibrary();
  const summary = validateLibrary(library);
  const payload = libraryPayload(library);
  if (process.argv.includes('--write-seed')) {
    const json = JSON.stringify(payload);
    if (json.includes('$curriculum_package$')) throw Error();
    await writeFile(
      'supabase/library-seed.sql',
      `-- Generated from content/library; server-only import data, never a browser asset.\nSELECT public.import_curriculum_package($curriculum_package$${json}$curriculum_package$::jsonb);\n`,
    );
    console.log('Validated library SQL prepared.', summary);
  } else if (process.argv.includes('--apply')) {
    const { url, serviceKey } = readServiceConfiguration(process.env);
    const db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await db
      .rpc('import_curriculum_package', { p_catalog: payload })
      .abortSignal(AbortSignal.timeout(60000));
    if (error) throw Error();
    console.log('Library imported atomically:', data);
  } else console.log('Library validated; no database changes.', summary);
} catch {
  console.error(
    'Library validation/import failed. Check package metadata, revision, ownership and server configuration. Details redacted; no forced overwrite.',
  );
  process.exitCode = 1;
}
