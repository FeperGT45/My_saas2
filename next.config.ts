import type { NextConfig } from 'next';
import { validatePublicKey } from './src/lib/supabase/config';
// Stop before a service credential in a public variable can enter browser assets.
if (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)
  validatePublicKey(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
};
export default nextConfig;
