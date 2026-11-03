import { bindings, defineConfig, defineWorker } from 'cf/config';

export default defineConfig({
  worker: defineWorker({
    name: 'voklumi',
    entrypoint: 'vinext/server/fetch-handler',
    compatibilityDate: '2026-11-02',
    compatibilityFlags: ['nodejs_compat'],
    assets: {
      htmlHandling: 'none',
      notFoundHandling: 'none',
      runWorkerFirst: ['/*', '!/_next/static/*', '!/*/_next/static/*'],
    },
    env: {
      ASSETS: bindings.assets(),
      NODE_ENV: bindings.text('production'),
      NEXT_PUBLIC_SUPABASE_URL: bindings.text(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
      ),
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: bindings.text(
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '',
      ),
      APP_URL: bindings.text(process.env.APP_URL ?? ''),
      TELEGRAM_BOT_USERNAME: bindings.text(
        process.env.TELEGRAM_BOT_USERNAME ?? 'Voklumi_bot',
      ),
      TELEGRAM_MINI_APP_SLUG: bindings.text(
        process.env.TELEGRAM_MINI_APP_SLUG ?? '',
      ),
      TELEGRAM_BOT_TOKEN: bindings.secret(),
      TELEGRAM_WEBHOOK_SECRET: bindings.secret(),
      SUPABASE_SECRET_KEY: bindings.secret(),
      ...(process.env.ADMIN_USER_IDS?.trim()
        ? { ADMIN_USER_IDS: bindings.secret() }
        : {}),
      ...(process.env.SUPABASE_HEALTHCHECK_SECRET?.trim()
        ? { SUPABASE_HEALTHCHECK_SECRET: bindings.secret() }
        : {}),
      ENABLE_LOCAL_AUTH: bindings.text('false'),
      TELEGRAM_STARS_PAYMENTS_ENABLED: bindings.text('false'),
      TELEGRAM_STARS_OWNER_REVIEWED: bindings.text('false'),
      TELEGRAM_STARS_REFUNDS_ENABLED: bindings.text('false'),
    },
  }),
});
