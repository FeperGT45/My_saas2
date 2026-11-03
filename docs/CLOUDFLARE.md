# Размещение Voklumi на Cloudflare Workers

Актуальное состояние размещения и исправленная production-последовательность на 3 ноября: [PRODUCTION.md](PRODUCTION.md). Ниже сохранено описание исходной подготовки; текущая команда production build — `npm run build:production`, deploy — `npm run deploy:cloudflare && npm run telegram:setup`.

Проверено 2 ноября 2026 года. Репозиторий: `FeperGT45/My_saas2`, приложение в корне, Next.js **16.4.3**, App Router, TypeScript. Здесь есть серверные route handlers, HttpOnly Telegram-сессии, проверка HMAC через `node:crypto`, административный allowlist, серверные SQL RPC Supabase и обработка Stars webhook. Статический экспорт на Pages отключил бы эти функции. Выбран **Cloudflare Workers с vinext 1.4.1**, рекомендованным текущей документацией Cloudflare. vinext имеет статус beta; обычный Next.js оставлен для разработки и регрессионной проверки.

Официальные источники:

- https://developers.cloudflare.com/workers/framework-guides/web-apps/nextjs/
- https://github.com/cloudflare/vinext#cloudflare-workers
- https://developers.cloudflare.com/cf/projects/
- https://developers.cloudflare.com/cf/projects/cloudflare-config/
- https://developers.cloudflare.com/workers/ci-cd/builds/configuration/

## Что подготовлено

`vite.config.ts` подключает vinext и официальный Cloudflare Vite plugin с RSC/SSR environments. `cloudflare.config.ts` задаёт имя `voklumi`, entrypoint `vinext/server/fetch-handler`, static assets, `nodejs_compat`, compatibility date `2026-11-02`. На этой дате строковые bindings доступны в `process.env`, поэтому существующие серверные методы Supabase и Telegram не переписываются. Динамические страницы и API обрабатывает Worker; SPA fallback не включён. Кэширование приватных данных через KV/Response Store не добавлено.

Конфигурацию сгенерировал официальный `vinext init --platform=cloudflare`; он использует новый `cf` и Cloudflare Build Output. Wrangler-файл не нужен. Не выбирайте старый preset `@cloudflare/next-on-pages` или каталог статического экспорта `out`.

Node для сборки: **24.22.0**, записан в `.node-version`. Требование нового cf CLI: Node `^22.23.0 || ^24.22.0 || ^26.12.0`. Зависимости зафиксированы в `package-lock.json`; в CI используйте `npm ci` и не исключайте devDependencies.

| Команда                      | Действие                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`                | Прежний Next.js dev server                                                                     |
| `npm run build`              | Прежняя production-сборка Next.js                                                              |
| `npm run dev:vinext`         | Worker dev server                                                                              |
| `npm run build:cloudflare`   | Worker + клиентские assets в `.cloudflare/output/v0`                                           |
| `npm run preview:cloudflare` | Локальный workerd preview на 127.0.0.1:3002                                                    |
| `npm run check:cloudflare`   | Проверка готового build output, dry-run без публикации                                         |
| `npm run deploy:cloudflare`  | **Реальная публикация** готовой production-сборки; выполнять только после разрешения владельца |
| `npm run test:cloudflare`    | Браузерные тесты с локальным Worker                                                            |

Сначала сборка, затем проверка/публикация: prebuilt-команда сама не пересобирает изменения. Для чистой проверки ESLint и Prettier исключают `.cloudflare`, `.vinext`, `dist`. Worker ambient types не включены глобально в браузерный tsconfig, чтобы не переопределять DOM Response. `typecheck` сначала обновляет типы маршрутов Next.js.

## Пошаговая настройка после разрешения публикации

1. Отправить подготовленные изменения текущего репозитория в GitHub. В этом этапе push и публикация не выполнялись. Перед запуском применить недостающие Supabase-миграции: последнее ранее подтверждённое удалённое состояние — 008, текущий код требует **010 / 22 таблицы**, то есть нужны 009 и 010 по порядку. Проверить staging/backup и выполнить `npm run db:check` в настроенном защищённом окружении. Серверный ключ API не является паролем PostgreSQL для миграций.
2. В Cloudflare Dashboard выбрать **Workers & Pages → Create application → Import a repository / Connect GitHub**, раздел **Workers**, и репозиторий `FeperGT45/My_saas2`. Не создавать Pages static site.
3. Задать настройки:

   | Поле                                | Значение                                                        |
   | ----------------------------------- | --------------------------------------------------------------- |
   | Worker / project name               | `voklumi` (должно совпадать с `cloudflare.config.ts`)           |
   | Production branch                   | `main`                                                          |
   | Root directory                      | корень репозитория `/`                                          |
   | Package manager                     | npm, установка по `package-lock.json`                           |
   | Build command                       | `npm run build:cloudflare`                                      |
   | Deploy command                      | `npm run deploy:cloudflare`                                     |
   | Framework preset, если предлагается | Custom / None: конфигурация уже в репозитории                   |
   | Output directory                    | не задавать как для Pages; используется `.cloudflare/output/v0` |

   Новый `cf` поддерживает собственный build output; не оставляйте стандартную команду `npx wrangler deploy`. Если интерфейс предлагает автоматическую публикацию preview-веток, отключите её до отдельного согласования. Создание Git-интеграции может сразу запустить deploy: финальную кнопку **Deploy** нажимать только после разрешения и настройки необходимых secrets. Дальнейшие push в production branch могут автоматически публиковаться.

4. В **Build → Variables and secrets** добавить обычные переменные из таблицы ниже. Build variables не становятся runtime bindings автоматически: нужные публичные значения и APP_URL конфигурация явно переносит в Worker. Изменение этих значений требует новой сборки.
5. В **Worker Settings → Variables and Secrets** добавить runtime Secrets из следующей таблицы. Не добавлять серверные ключи в `NEXT_PUBLIC_*`, `VITE_*`, GitHub-файлы или журналы сборки. При невозможности добавить secrets до первого deploy создайте Worker/configuration без подключения автоматического deploy, настройте secrets, затем подключите Git build. Не выдавайте незавершённую конфигурацию за рабочую авторизацию.
6. После разрешения и завершения настройки опубликовать. Заранее определить HTTPS origin: например `https://voklumi.<ваш-workers-subdomain>.workers.dev` из Workers account settings либо собственный домен. Это точное значение `APP_URL`, без пути; случайный preview URL для production не использовать.
7. В BotFather указать тот же HTTPS URL для Main Mini App/Menu Button и фактическое имя бота. После размещения и проверки приложения отдельно запустить операторскую команду `npm run telegram:setup` в окружении с `APP_URL`, токеном и webhook secret: она регистрирует `/api/telegram/webhook`, команды и allowed_updates. Эта команда **не запускалась** при подготовке Cloudflare.
8. Проверить `/api/health`, защищённый `/api/health/database` через мониторинг с bearer secret (если задан), Telegram-вход в реальном мобильном клиенте, сохранение урока, повторный запрос, отсутствие доступа ученика к `/api/admin`. Полный удалённый цикл требует настоящих runtime secrets и размещения.

## Переменные

### Build environment: обычные переменные

| Имя                                    | Значение                                                                                         |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `NODE_VERSION`                         | `24.22.0`                                                                                        |
| `NEXT_PUBLIC_SUPABASE_URL`             | `https://<project-ref>.supabase.co`, без `/rest/v1`                                              |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Только publishable либо legacy anon key выбранного проекта                                       |
| `NEXT_PUBLIC_ENABLE_LOCAL_DEMO`        | `false` для production (при желании публичный демообзор можно оставить `true`; он не авторизует) |
| `APP_URL`                              | Точный production HTTPS origin приложения                                                        |
| `TELEGRAM_BOT_USERNAME`                | Фактический username бота без `@` из BotFather                                                   |
| `TELEGRAM_MINI_APP_SLUG`               | Необязательно, short name Mini App; иначе оставить пустым                                        |

Для runtime эти public Supabase значения, APP_URL и параметры бота задаёт `cloudflare.config.ts`. NODE_ENV зафиксирован как production. Локальная авторизация и три переключателя реальных Stars-операций зафиксированы `false`. Включение монетизации — отдельная проверка владельцем, не часть размещения.

### Runtime secrets

| Имя                           | Обязательность / источник                                                                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SUPABASE_SECRET_KEY`         | Обязательно: server secret выбранного Supabase проекта. Используется только сервером. Для данного Worker настроен современный ключ; не нужны одновременно два privileged key |
| `TELEGRAM_BOT_TOKEN`          | Обязательно для Telegram-входа/webhook; получить в BotFather                                                                                                                 |
| `TELEGRAM_WEBHOOK_SECRET`     | Обязательно для webhook: независимая случайная строка от 32 символов                                                                                                         |
| `ADMIN_USER_IDS`              | Необязательно: внутренние UUID владельцев, через запятую. Отсутствие закрывает административный доступ                                                                       |
| `SUPABASE_HEALTHCHECK_SECRET` | Необязательно: независимый секрет от 32 символов для защищённого DB health endpoint                                                                                          |

Остальные платежные параметры из `.env.example` пока не нужны: покупки остаются отключены. Пароль БД, Supabase access token и project ref нужны только оператору миграций, не Worker runtime. `LOCAL_AUTH_SECRET` не добавлять в production. `NODE_USE_ENV_PROXY=1` нужен только в данном проксируемом Codex Cloud, в Cloudflare runtime не требуется.

Для CLI-публикации вместо dashboard: `CLOUDFLARE_API_TOKEN` — Secret CI с разрешением редактирования Workers выбранного аккаунта (и Workers Builds, если CI их управляет); `CLOUDFLARE_ACCOUNT_ID` — идентификатор аккаунта, доступный CI. Локально допустим `cf auth login`. Эти параметры не являются секретами приложения и не передаются пользователям. Runtime secrets можно настроить в dashboard или через поддерживаемую операторскую загрузку secrets; нельзя коммитить файл со значениями.

## Локальная проверка и Supabase

```bash
npm ci
npm run typecheck
npm run lint
npm run build
npm run build:cloudflare
npm run check:cloudflare
npm run test:cloudflare
```

Для локальных секретов Vite/Worker можно использовать игнорируемый `.dev.vars`; `.env.example` содержит только имена. Не копируйте production-секреты в отслеживаемый файл. Производственные флаги local auth остаются выключены даже в локальном preview.

Supabase подключается через `@supabase/supabase-js` 2.118.0 и HTTPS PostgREST/Auth admin API, а не через постоянное TCP-подключение PostgreSQL. `node:crypto`, Buffer, HttpOnly cookies и runtime env обеспечиваются Workers + vinext и compatibility flag. Серверные операции по-прежнему проверяют identity и вызывают транзакционные RPC, RLS/права не ослабляются.

Проверены оба build, dry-run и локальные тесты SQL/SDK/авторизации. Браузерный набор проверяет экраны на 320/390/768px, шесть форматов уроков, клиентскую навигацию и защищённые API на локальном Workers preview. Его отдельный admin integration fixture запускает production Next.js против локального HTTPS PostgREST/PGlite; это не удалённая проверка администратора на Cloudflare. Остальные SQL-backed browser fixtures подменяют транспорт данных, не заявляют реальный доступ к удалённой Supabase.

Удалённое соединение Supabase и полный Telegram WebView не проверялись: в этом окружении нет настроенных runtime credentials. Новые миграции, Worker, домен, webhook и реальные платежи не публиковались и не изменялись. В сборке beta-adapter остаются некритические предупреждения об оптимизации импортов/картах исходников; они не означают успешный production-платёж или проверку всех возможностей Next.js.

## Результат попытки публикации после разрешения владельца

В аккаунте Cloudflare зарегистрирован account subdomain `voklumi67.workers.dev`. Планируемый адрес приложения: `https://voklumi.voklumi67.workers.dev`. Это ещё не подтверждённый работающий сайт.

Cloudflare принял статические assets, но остановил создание Worker из-за отсутствия `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `SUPABASE_SECRET_KEY`. Не создавались фиктивные ключи и не отключалась проверка обязательных secrets. Автоматическая отправка кода в GitHub также завершилась HTTP 403: текущая Git-авторизация не имеет права push в `FeperGT45/My_saas2`.

Для первого deploy нового Worker secrets нельзя добавить к ещё не существующему скрипту. Поэтому `npm run deploy:cloudflare` теперь использует защищённый bootstrap: читает три обязательных значения (и необязательные admin/health secrets) из окружения, создаёт временный JSON вне репозитория с правами 0600, вызывает официальный `cf deploy --prebuilt --mode production --secrets-file …`, затем удаляет временный каталог. Значения не передаются аргументами команд и не печатаются bootstrap-скриптом.

Чтобы продолжить из Codex, в **Settings → Environments → окружение репозитория → Secrets** задайте три обязательных runtime-секрета; webhook secret — отдельная случайная строка от 32 символов. В обычных переменных задайте `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `APP_URL=https://voklumi.voklumi67.workers.dev`, фактический `TELEGRAM_BOT_USERNAME`. Обеспечьте доступность значений именно runtime процесса задачи; не копируйте их в Git или сообщения. После изменения подключите обновлённое окружение к задаче.

Для Cloudflare Workers Builds при использовании нового bootstrap значения runtime Secrets должны также безопасно поступать в процесс deploy как Build Secrets (отдельно от публичных Build variables); скрипт загрузит их как runtime secrets. Для уже существующего Worker можно пользоваться прямым `cf deploy --prebuilt --mode production` с ранее настроенными runtime secrets. Выберите один способ управления secrets и не подменяйте их пустыми значениями.

После настройки окружения: повторить build, dry-run, deploy, затем проверить доступность сайта и DB readiness. Для миграций 009/010 потребуется отдельный административный доступ Supabase. Не включать реальные платежи вместе с первым размещением.
