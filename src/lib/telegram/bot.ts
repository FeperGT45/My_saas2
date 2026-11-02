export function miniAppUrl(value: string | undefined) {
  if (!value) throw new Error('APP_URL is required');
  const url = new URL(value);
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  )
    throw new Error(
      'APP_URL must be a public HTTPS URL without query or credentials',
    );
  return url.href;
}
export function startMessage(text: string, botUsername: string) {
  const command = text.split(/\s/)[0];
  return (
    command === '/start' ||
    command.toLowerCase() === `/start@${botUsername.toLowerCase()}`
  );
}
