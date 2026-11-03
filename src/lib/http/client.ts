/** Bound browser requests, while preserving cancellation when a screen is left. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init?: RequestInit,
  timeoutMs = 15000,
) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  const signal =
    init?.signal ?? (input instanceof Request ? input.signal : undefined);
  if (signal?.aborted) cancel();
  else signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      'Не удалось связаться с сервером. Проверь интернет и повтори попытку.',
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Do not show HTML proxy errors or native JSON parser diagnostics to the user. */
export async function readJson(response: Response) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      response.json(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Response timeout')), 15000);
      }),
    ]);
  } catch {
    throw new Error('Сервер вернул некорректный ответ. Повтори попытку позже.');
  } finally {
    clearTimeout(timer);
  }
}
