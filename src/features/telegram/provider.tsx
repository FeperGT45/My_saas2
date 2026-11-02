'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { isLocalDemo } from '@/config/env';
type Account = {
  id: string;
  name: string;
  avatarUrl: string | null;
  telegramId: string | null;
  mode: 'telegram' | 'local';
};
type TelegramState = {
  status: 'loading' | 'telegram' | 'demo' | 'outside' | 'error';
  account: Account | null;
  authError: boolean;
  refresh: () => Promise<void>;
};
const TelegramContext = createContext<TelegramState>({
  status: 'loading',
  account: null,
  authError: false,
  refresh: async () => {},
});
export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TelegramState['status']>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const [authError, setAuthError] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  async function refresh() {
    try {
      const response = await fetch('/api/auth/session', { cache: 'no-store' });
      if (response.status === 401) {
        setAccount(null);
        return;
      }
      if (!response.ok) throw new Error();
      const data = await response.json();
      setAccount(data.user);
      setAuthError(false);
    } catch {
      setAuthError(true);
    }
  }
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    async function setup() {
      try {
        const sdk = await import('@tma.js/sdk-react');
        if (!active) return;
        if (!sdk.isTMA()) {
          setStatus(isLocalDemo ? 'demo' : 'outside');
          await refresh();
          return;
        }
        cleanup = sdk.init();
        if (sdk.miniApp.mount.isAvailable()) await sdk.miniApp.mount();
        if (sdk.viewport.mount.isAvailable()) await sdk.viewport.mount();
        if (!active) return;
        if (sdk.viewport.bindCssVars.isAvailable()) sdk.viewport.bindCssVars();
        if (sdk.viewport.expand.isAvailable()) sdk.viewport.expand();
        if (sdk.miniApp.ready.isAvailable()) sdk.miniApp.ready();
        setStatus('telegram');
        const initData = sdk.retrieveRawInitData();
        if (!initData) throw new Error();
        const response = await fetch('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        });
        if (!response.ok) {
          if (active) setAuthError(true);
          return;
        }
        if (active) await refresh();
      } catch {
        if (active) {
          setStatus('error');
          setAuthError(true);
        }
      }
    }
    void setup();
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);
  useEffect(() => {
    if (status !== 'telegram') return;
    let off: (() => void) | undefined;
    let active = true;
    void import('@tma.js/sdk-react').then((sdk) => {
      if (!active) return;
      if (sdk.backButton.mount.isAvailable()) sdk.backButton.mount();
      if (pathname === '/') {
        if (sdk.backButton.hide.isAvailable()) sdk.backButton.hide();
      } else if (sdk.backButton.show.isAvailable()) sdk.backButton.show();
      if (sdk.backButton.onClick.isAvailable())
        off = sdk.backButton.onClick(() =>
          router.push(
            pathname === '/lesson'
              ? '/learn'
              : ['/settings', '/achievements'].includes(pathname)
                ? '/profile'
                : '/',
          ),
        );
    });
    return () => {
      active = false;
      off?.();
    };
  }, [pathname, status, router]);
  return (
    <TelegramContext.Provider value={{ status, account, authError, refresh }}>
      {children}
    </TelegramContext.Provider>
  );
}
export function useTelegram() {
  return useContext(TelegramContext);
}
