import Link from 'next/link';
import { Card, PageTitle } from '@/components/ui/game';
import { premiumPlans, premiumSupportUrl } from '@/lib/billing/plans';

export const metadata = { title: 'Условия Premium' };
export default function PremiumTermsPage() {
  return (
    <>
      <PageTitle
        title="Условия Voklumi Premium"
        eyebrow="Понятная покупка"
        description="Срок доступа, продление и помощь с покупкой."
      />
      <Card className="space-y-5">
        <section>
          <h2 className="mb-2 font-bold">Тарифы</h2>
          <ul className="list-inside list-disc space-y-2">
            {premiumPlans.map((p) => (
              <li key={p.id}>
                {p.title}: {p.amount} Telegram Stars за {p.days} дней.
              </li>
            ))}
          </ul>
        </section>
        <section>
          <h2 className="mb-2 font-bold">Начало и окончание доступа</h2>
          <p>
            Premium активируется после подтверждения покупки сервером Telegram.
            Дату окончания можно посмотреть на экране Premium. После окончания
            сохраняются аккаунт, словари и учебный прогресс; остаются доступны
            бесплатные возможности.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-bold">Без автопродления</h2>
          <p>
            Это разовая покупка. Автоматического списания нет. Для нового
            периода нужна новая покупка; пока Premium активен, приложение не
            предлагает повторно оплатить тот же доступ.
          </p>
        </section>
        <section>
          <h2 className="mb-2 font-bold">Помощь и возвраты</h2>
          <p>
            Если Stars списаны, а доступ не появился, обнови статус на экране
            Premium. Если проблема сохраняется или нужен возврат, напиши в
            поддержку, указав дату и сведения о покупке. Не отправляй пароль,
            код входа или платёжные секреты. Возврат и изменение доступа
            обрабатываются после проверки покупки.
          </p>
          <a
            className="text-primary mt-3 inline-flex min-h-12 items-center underline"
            href={premiumSupportUrl}
            target="_blank"
            rel="noreferrer"
          >
            Поддержка @feper145
          </a>
        </section>
        <p className="text-muted-foreground text-sm">
          Проверяй сумму и срок в счёте Telegram перед подтверждением. Пока
          покупки отключены владельцем, приложение не создаёт платёжные счета.
        </p>
      </Card>
      <Link
        className="text-primary mt-4 inline-flex min-h-12 items-center"
        href="/premium"
      >
        ← Вернуться к Premium
      </Link>
    </>
  );
}
