import { createClient } from '@supabase/supabase-js';
import {
  readServiceConfiguration,
  SupabaseConfigurationError,
} from '../src/lib/supabase/config';
import { isDatabaseReady } from '../src/lib/supabase/readiness';
async function main() {
  let config;
  try {
    config = readServiceConfiguration(process.env);
  } catch (error) {
    console.error(
      error instanceof SupabaseConfigurationError
        ? error.message
        : 'Invalid Supabase configuration.',
    );
    process.exitCode = 2;
    return;
  }
  try {
    const db = createClient(config.url, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              ...(init?.signal ? [init.signal] : []),
              AbortSignal.timeout(15000),
            ]),
          }),
      },
    });
    const { data, error } = await db.rpc('voklumi_database_status');
    if (error) {
      console.error(
        'Database check failed: verify network access, server key and migration 007. Remote error details redacted.',
      );
      process.exitCode = 1;
      return;
    }
    if (!isDatabaseReady(data)) {
      console.error(
        'Database is reachable but schema or permissions are not ready. Review migrations and RLS; no writes performed.',
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `PASS: schema ${data.schemaVersion}; ${data.tables.length} tables present with RLS; client writes/private reads denied; RPC permissions verified. No data changed.`,
    );
  } catch {
    console.error(
      'Database check failed: connection unavailable or timed out. Details redacted.',
    );
    process.exitCode = 1;
  }
}
void main();
