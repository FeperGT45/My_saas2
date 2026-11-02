'use client';
import { createContext, useContext, useEffect, useState } from 'react';
import { isLocalDemo } from '@/config/env';
type TelegramState = {
  status: 'loading' | 'telegram' | 'demo' | 'outside' | 'error';
};
const TelegramContext = createContext<TelegramState>({ status: 'loading' });
export function TelegramProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<TelegramState>({ status: 'loading' });
  useEffect(() => {
    let active = true;
    let cleanup: (() => void) | undefined;
    async function setup() {
      try {
        const sdk = await import('@tma.js/sdk-react');
        if (!active) return;
        if (!sdk.isTMA()) {
          setState({ status: isLocalDemo ? 'demo' : 'outside' });
          return;
        }
        cleanup = sdk.init();
        if (sdk.miniApp.mount.isAvailable()) await sdk.miniApp.mount();
        if (!active) return;
        if (sdk.miniApp.ready.isAvailable()) sdk.miniApp.ready();
        setState({ status: 'telegram' });
      } catch {
        if (active) setState({ status: 'error' });
      }
    }
    void setup();
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);
  return (
    <TelegramContext.Provider value={state}>
      {children}
    </TelegramContext.Provider>
  );
}
export function useTelegram() {
  return useContext(TelegramContext);
}
