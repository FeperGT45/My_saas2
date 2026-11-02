import 'server-only';
import { createServiceClient } from './service';
/** Internal job/grader only. Do not wrap in a public Server Action or route accepting client completion claims. */
export async function awardVerifiedAttempt(
  attemptId: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(attemptId))
    throw new Error('Invalid attempt ID');
  const client = createServiceClient();
  const { data, error } = await client.rpc('award_completed_lesson', {
    p_attempt_id: attemptId,
  });
  if (error) throw new Error('Unable to award verified attempt');
  return data === true;
}
