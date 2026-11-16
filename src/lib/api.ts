// Same-origin when served by the API container; `npm run dev` points this at :8787 via .env.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "";

// Task periods roll over at local midnight, so every request carries the user's zone.
const TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// A healthy API answers in milliseconds. A request still waiting after this long is stuck behind
// a hung Docker or WSL, and is reported instead of leaving "Saving…" on screen forever.
export const DEFAULT_TIMEOUT_MS = 30_000;
// Sending a large file takes longer than any other request.
export const UPLOAD_TIMEOUT_MS = 180_000;

// Nothing answered: the API's container is down, or Docker or WSL beneath it.
export class ApiUnreachableError extends Error {
  constructor(message = "Argonaut's services aren't answering") {
    super(message);
    this.name = "ApiUnreachableError";
  }
}

// The API answered with an error. `data` is the whole answer, for errors that carry more than
// words (a save conflict carries the stored note).
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly data: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// What to show for a failure, whatever was thrown.
export function errorMessage(cause: unknown, fallback = "That didn't work"): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

export interface ApiOptions {
  // How long to wait for an answer; null waits as long as the caller's own signal allows.
  timeoutMs?: number | null;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("X-Timezone", TIME_ZONE);
  if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  const signals = [init.signal, timeoutMs === null ? null : AbortSignal.timeout(timeoutMs)].filter(
    (signal): signal is AbortSignal => Boolean(signal),
  );

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: signals.length > 1 ? AbortSignal.any(signals) : signals[0],
    });
  } catch (cause) {
    // A caller cancelling its own request isn't an outage.
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiUnreachableError(
      cause instanceof DOMException && cause.name === "TimeoutError"
        ? "Argonaut's services didn't answer in time"
        : undefined,
    );
  }
  if (!response.ok) {
    const data: unknown = await response.json().catch(() => null);
    const body = data !== null && typeof data === "object" ? (data as Record<string, unknown>) : {};
    const message = typeof body.error === "string" ? body.error : `Request failed (${response.status})`;
    throw new ApiError(response.status, message, body);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Notes store images as /api/... paths; during development the API runs on another origin.
export function resolveApiUrl(url: string): string {
  return url.startsWith("/api/") ? `${API_BASE_URL}${url}` : url;
}
