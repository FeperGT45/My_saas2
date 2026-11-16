/** A stable DTO for both RPC JSON and PostgREST timestamps; never exposes user_id. */
export function deletionTicket(value: unknown) {
  if (!value || typeof value !== 'object')
    throw Error('Invalid deletion ticket');
  const v = value as Record<string, unknown>;
  const created = typeof v.createdAt === 'string' ? v.createdAt : v.created_at;
  if (
    typeof v.id !== 'string' ||
    typeof v.status !== 'string' ||
    !['pending', 'processing', 'completed', 'cancelled'].includes(v.status) ||
    typeof created !== 'string' ||
    !Number.isFinite(Date.parse(created))
  )
    throw Error('Invalid deletion ticket');
  return {
    id: v.id,
    status: v.status,
    createdAt: new Date(created).toISOString(),
  };
}
