import { createClient } from '@supabase/supabase-js';
import { readCatalog, importPayload } from './content/catalog.mjs';
const payload = importPayload(await readCatalog());
const counts = Object.fromEntries(
  ['courses', 'units', 'lessons', 'exercises'].map((key) => [
    key,
    payload[key].length,
  ]),
);
if (!process.argv.includes('--apply'))
  console.log('Validated dry run; no database changes.', counts);
else {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      'Set server Supabase env before --apply. Never pass credentials as arguments.',
    );
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await db.rpc('import_english_curriculum', {
    p_catalog: payload,
  });
  if (error) {
    console.error(
      'Curriculum import failed; transaction rolled back. Apply migration 005 and check catalog configuration.',
    );
    process.exitCode = 1;
  } else console.log('Curriculum imported atomically:', data);
}
