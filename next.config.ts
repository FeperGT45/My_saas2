import type { NextConfig } from 'next';
import { validatePublicKey } from './src/lib/supabase/config';
// Stop before a service credential in a public variable can enter browser assets.
if (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  validatePublicKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Telegram Web must be able to embed the Mini App.
          {
            key: 'Content-Security-Policy',
            value:
              "frame-ancestors 'self' https://telegram.org https://*.telegram.org",
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};
export default nextConfig;
