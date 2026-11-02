export const isLocalDemo =
  process.env.NODE_ENV === 'development' &&
  process.env.NEXT_PUBLIC_ENABLE_LOCAL_DEMO === 'true';
