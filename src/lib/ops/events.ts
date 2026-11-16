import 'server-only';
import { createServiceClient } from '@/lib/supabase/service';
export type OpsErrorCode =
  | 'payment_webhook'
  | 'telegram_webhook'
  | 'payment_invoice'
  | 'lesson_api'
  | 'privacy_api'
  | 'admin_api';
/** Deliberately accepts no exception, URL, request body, user or credential. */
export async function recordOpsError(code: OpsErrorCode) {
  try {
    const { error } = await createServiceClient()
      .rpc('record_ops_error', { p_code: code })
      .abortSignal(AbortSignal.timeout(1200));
    if (error) console.error('voklumi_ops_journal_unavailable');
  } catch {
    console.error('voklumi_ops_journal_unavailable');
  }
}
