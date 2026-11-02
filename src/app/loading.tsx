export default function Loading() {
  return (
    <div
      role="status"
      aria-label="Загрузка страницы"
      className="animate-pulse space-y-5"
    >
      <span className="sr-only">Загружаем твою вселенную…</span>
      <div className="bg-muted h-8 w-3/4 rounded-xl" />
      <div className="bg-card h-56 rounded-3xl" />
      <div className="grid grid-cols-3 gap-3">
        {[1, 2, 3].map((n) => (
          <div key={n} className="bg-card h-24 rounded-2xl" />
        ))}
      </div>
      <div className="bg-card h-24 rounded-3xl" />
    </div>
  );
}
