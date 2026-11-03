import type { Metadata, Viewport } from 'next';
import { AppShell } from '@/components/layout/app-shell';
import { TelegramProvider } from '@/features/telegram/provider';
import { SoundProvider } from '@/features/sound/sound-provider';
import './globals.css';
export const metadata: Metadata = {
  title: { default: 'Voklumi — учись играя', template: '%s · Voklumi' },
  description: 'Изучение иностранных языков маленькими шагами в Telegram.',
};
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#10101e',
};
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>
        <SoundProvider>
          <TelegramProvider>
            <AppShell>{children}</AppShell>
          </TelegramProvider>
        </SoundProvider>
      </body>
    </html>
  );
}
