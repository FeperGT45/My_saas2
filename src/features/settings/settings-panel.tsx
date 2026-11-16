'use client';
import { useState } from 'react';
import {
  Volume2,
  Vibrate,
  Sparkles,
  Globe,
  Moon,
  ShieldCheck,
  RotateCcw,
} from 'lucide-react';
import { useExperiencePreferences } from '@/features/experience/experience-provider';
import {
  setExperiencePreferences,
  defaultExperiencePreferences,
} from '@/lib/experience/preferences';
import { Card, PageTitle } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
import { useSoundPreferences } from '@/features/sound/sound-provider';
import {
  setSoundPreferences,
  defaultSoundPreferences,
  unlockSounds,
  playSound,
} from '@/lib/sound/audio';
export function SettingsPanel() {
  const experience = useExperiencePreferences();
  const [notice, setNotice] = useState('');
  const sound = useSoundPreferences();
  const checked = (key: 'sound' | 'speech' | 'haptics' | 'effects') =>
    key === 'sound'
      ? sound.enabled
      : key === 'speech'
        ? sound.speech
        : experience[key];
  return (
    <>
      <PageTitle
        eyebrow="Твой ритм"
        title="Всё под тебя"
        description="Настройки сохраняются на этом устройстве. Виброотклик доступен в поддерживаемых клиентах Telegram."
      />
      <Card>
        <h2 className="eyebrow mb-2">Впечатления</h2>
        {[
          {
            key: 'sound' as const,
            icon: Volume2,
            label: 'Звуки',
            description:
              'Все звуки: нажатия, ответы, завершение уроков и голос',
          },
          {
            key: 'speech' as const,
            icon: Volume2,
            label: 'Озвучка упражнений',
            description: 'Чтение фраз при нажатии кнопки прослушивания',
          },
          {
            key: 'haptics' as const,
            icon: Vibrate,
            label: 'Виброотклик',
            description: 'Отклик на нажатия и результаты ответов в Telegram',
          },
          {
            key: 'effects' as const,
            icon: Sparkles,
            label: 'Эффекты',
            description: 'Анимации переходов, карточек и наград',
          },
        ].map(({ key, icon: Icon, label, description }) => (
          <div
            key={key}
            className="border-border flex items-center gap-3 border-b py-4 last:border-0"
          >
            <Icon size={20} className="text-primary shrink-0" />
            <div className="min-w-0 flex-1">
              <p id={`label-${key}`} className="text-sm font-semibold">
                {label}
              </p>
              <p className="text-muted-foreground mt-1 text-[10px]">
                {description}
              </p>
            </div>
            <button
              role="switch"
              aria-checked={checked(key)}
              aria-labelledby={`label-${key}`}
              data-sound={
                key === 'sound' || key === 'speech' ? 'off' : undefined
              }
              onClick={() => {
                if (key === 'sound')
                  setSoundPreferences({ enabled: !sound.enabled });
                else if (key === 'speech')
                  setSoundPreferences({ speech: !sound.speech });
                else setExperiencePreferences({ [key]: !experience[key] });
                setNotice(
                  'Настройки применены и сохранены на этом устройстве.',
                );
              }}
              className="flex min-h-11 min-w-12 items-center justify-center"
            >
              <span
                className={`flex h-6 w-11 items-center rounded-full p-1 transition-colors ${checked(key) ? 'bg-primary' : 'bg-muted'}`}
              >
                <span
                  className={`size-4 rounded-full bg-white shadow transition-transform ${checked(key) ? 'translate-x-5' : ''}`}
                />
              </span>
            </button>
          </div>
        ))}
        <Button
          variant="outline"
          className="mt-3 w-full"
          data-sound="off"
          disabled={!sound.enabled}
          onClick={() => {
            unlockSounds();
            playSound('complete');
          }}
        >
          Проверить звук
        </Button>
      </Card>
      <Card className="mt-4">
        <h2 className="eyebrow mb-2">Приложение</h2>
        <div className="flex items-center gap-3 py-4">
          <Globe size={20} className="text-teal-300" />
          <span className="flex-1 text-sm">Язык интерфейса</span>
          <span className="text-muted-foreground text-xs">Русский</span>
        </div>
        <div className="border-border flex items-center gap-3 border-t py-4">
          <Moon size={20} className="text-primary" />
          <span className="flex-1 text-sm">Тема</span>
          <span className="text-muted-foreground text-xs">Тёмная</span>
        </div>
      </Card>
      <Button
        variant="outline"
        className="mt-5 w-full"
        onClick={() => {
          setExperiencePreferences(defaultExperiencePreferences);
          setSoundPreferences(defaultSoundPreferences);
          setNotice('Настройки сброшены.');
        }}
      >
        <RotateCcw size={16} />
        Сбросить настройки
      </Button>
      <p
        role="status"
        className="mt-3 min-h-8 text-center text-xs text-teal-200"
      >
        {notice}
      </p>
      <p className="text-muted-foreground mt-3 flex gap-2 text-[11px] leading-relaxed">
        <ShieldCheck size={18} className="shrink-0" />
        Системная настройка уменьшения движения учитывается автоматически.
        Громкость устройства регулируется отдельно. В браузере без поддержки
        Telegram виброотклик недоступен.
      </p>
      <p className="text-muted-foreground mt-6 text-center text-[10px]">
        VOKLUMI · НАСТРОЙКИ УСТРОЙСТВА
      </p>
    </>
  );
}
