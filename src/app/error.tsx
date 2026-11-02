'use client';
import { Button } from '@/components/ui/button';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div role="alert">
      <h1 className="text-2xl font-bold">Не удалось открыть страницу</h1>
      <p className="text-muted-foreground my-4">Попробуйте ещё раз.</p>
      <Button onClick={reset}>Повторить</Button>
    </div>
  );
}
