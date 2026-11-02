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
import { Card, PageTitle } from '@/components/ui/game';
import { Button } from '@/components/ui/button';
export function SettingsPanel() {
  const [settings, setSettings] = useState({
    sound: true,
    haptics: false,
    effects: true,
  });
  const [notice, setNotice] = useState('');
  return (
    <>
      <PageTitle
        eyebrow="Твой ритм"
        title="Всё под тебя"
        description="Демонстрация настроек. Изменения действуют только на этом экране и сбрасываются при выходе."
      />
      <Card>
        <h2 className="eyebrow mb-2">Впечатления</h2>
        {[
          {
            key: 'sound' as const,
            icon: Volume2,
            label: 'Звуки',
            description: 'Пример настройки звуков',
          },
          {
            key: 'haptics' as const,
            icon: Vibrate,
            label: 'Виброотклик',
            description: 'Пример настройки отклика',
          },
          {
            key: 'effects' as const,
            icon: Sparkles,
            label: 'Эффекты',
            description: 'Пример настройки анимаций',
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
              aria-checked={settings[key]}
              aria-labelledby={`label-${key}`}
              onClick={() => {
                setSettings((s) => ({ ...s, [key]: !s[key] }));
                setNotice(
                  'Демонстрационный переключатель изменён. Настройка не сохранена.',
                );
              }}
              className="flex min-h-11 min-w-12 items-center justify-center"
            >
              <span
                className={`flex h-6 w-11 items-center rounded-full p-1 transition-colors ${settings[key] ? 'bg-primary' : 'bg-muted'}`}
              >
                <span
                  className={`size-4 rounded-full bg-white shadow transition-transform ${settings[key] ? 'translate-x-5' : ''}`}
                />
              </span>
            </button>
          </div>
        ))}
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
          setSettings({ sound: true, haptics: false, effects: true });
          setNotice('Демонстрационные настройки сброшены.');
        }}
      >
        <RotateCcw size={16} />
        Сбросить настройки демо
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
        Переключатели выше не управляют устройством.
      </p>
      <p className="text-muted-foreground mt-6 text-center text-[10px]">
        VOKLUMI · UI PREVIEW 0.2
      </p>
    </>
  );
}
