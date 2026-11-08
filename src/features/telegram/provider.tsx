'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { fetchWithTimeout, readJson } from '@/lib/http/client';
import { usePathname, useRouter } from 'next/navigation';
import { isLocalDemo } from '@/config/env';
import { matchesLaunchAccount } from './session-resume';
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
  refresh: () => Promise<Account | null>;
};
const TelegramContext = createContext<TelegramState>({
  status: 'loading',
  account: null,
  authError: false,
  refresh: async () => null,
});
export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TelegramState['status']>('loading');
  const [account, setAccount] = useState<Account | null>(null);
  const [authError, setAuthError] = useState(false);
  const refreshVersion = useRef(0);
  const pathname = usePathname();
  const router = useRouter();
  async function refresh() {
    const version = ++refreshVersion.current;
    try {
      const response = await fetchWithTimeout('/api/auth/session', {
        cache: 'no-store',
      });
      if (version !== refreshVersion.current) return null;
      if (response.status === 401) {
        setAccount(null);
        setAuthError(false);
        return null;
      }
      if (!response.ok) throw new Error();
      const data = await readJson(response);
      if (version !== refreshVersion.current) return null;
      setAccount(data.user);
      setAuthError(false);
      return data.user as Account;
    } catch {
      if (version !== refreshVersion.current) return null;
      setAccount(null);
      setAuthError(true);
      return null;
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
        // A valid server session outlives the five-minute initData login window.
        // A different Telegram account must still pass fresh server signature validation.
        const existing = await refresh();
        if (!active) return;
        if (matchesLaunchAccount(existing, initData)) return;
        setAccount(null);
        const response = await fetchWithTimeout('/api/auth/telegram', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ initData }),
        });
        if (!response.ok) {
          if (active) setAuthError(true);
          return;
        }
        if (active && !(await refresh())) setAuthError(true);
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
            pathname === '/library'
              ? '/courses'
              : pathname === '/lesson'
                ? '/learn'
                : [
                      '/settings',
                      '/achievements',
                      '/friends',
                      '/premium',
                      '/admin',
                      '/placement',
                      '/learning-plan',
                      '/review',
                    ].includes(pathname)
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
