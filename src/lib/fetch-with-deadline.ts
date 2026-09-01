const REQUEST_DEADLINE_MS = 8_000;

export class RequestDeadlineError extends Error {
  constructor() {
    super('The request timed out.');
    this.name = 'RequestDeadlineError';
  }
}

export async function fetchWithDeadline(input: RequestInfo | URL, init: RequestInit = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(init.signal?.reason);
  init.signal?.addEventListener('abort', abort, { once: true });
  const timeout = window.setTimeout(() => controller.abort(new RequestDeadlineError()), REQUEST_DEADLINE_MS);

  try {
    return await Promise.race([
      fetch(input, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(
          init.signal?.aborted ? init.signal.reason : new RequestDeadlineError(),
        ), { once: true });
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abort);
  }
}
