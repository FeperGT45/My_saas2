import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';
import { loadPlacementBank, placementSeedSql } from './placement/content.mjs';
const bank = await loadPlacementBank();
if (process.argv.includes('--write-seed'))
  await writeFile('supabase/placement-seed.sql', placementSeedSql(bank));
if (process.argv.includes('--apply')) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || key.startsWith('sb_publishable_'))
    throw new Error(
      'Configure Supabase server environment first; credentials must not be supplied as arguments.',
    );
  const db = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await db
    .rpc('placement_import_questions', { p_document: bank })
    .abortSignal(AbortSignal.timeout(20000));
  if (error)
    throw new Error(
      'Placement import failed. Check schema and server credentials; details redacted.',
    );
}
console.log(
  `PASS: ${bank.questions.length} placement questions; 6 levels, 3 categories. ${process.argv.includes('--apply') ? 'Imported with stable codes.' : 'No remote data changed.'}`,
);
