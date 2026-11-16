'use client';
import { useTelegram } from '@/features/telegram/provider';
import { AdminAccessMessage } from './access-message';
/** Server pages authorize first; this boundary also hides cached data after account changes. */
export function AdminDataBoundary({
  owner,
  children,
}: {
  owner: string;
  children: React.ReactNode;
}) {
  const { account, status } = useTelegram();
  if (status === 'loading') return <p role="status">Проверяем доступ…</p>;
  if (account?.mode !== 'telegram' || account.id !== owner)
    return <AdminAccessMessage />;
  return children;
}
