import Link from 'next/link';
import { Button } from '@/components/ui/button';
export default function NotFound() {
  return (
    <>
      <h1 className="text-3xl font-bold">Страница не найдена</h1>
      <p className="text-muted-foreground my-5">
        Вернёмся на знакомый маршрут.
      </p>
      <Button asChild>
        <Link href="/">На главную</Link>
      </Button>
    </>
  );
}
