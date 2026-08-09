/**
 * All API traffic flows over HTTP to the runtime's `/api` surface:
 *   - JSON/upload requests  → fetch(`/api/<path>`)
 *   - Event streams         → EventSource(`/api/<path>`)
 *   - <img src> / URL-only  → apiUrl() returns a same-origin `/api/<path>`
 *
 * Served same-origin by the runtime in production; proxied to the runtime by
 * Vite's `/api` proxy in dev (see vite.config.ts). Override the base with
 * `VITE_API_BASE` to point a detached dev frontend at a remote runtime.
 */

import { publishConnectivity } from "@/lib/connectivity-bus";

const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

/**
 * Build a same-origin URL usable in DOM attributes like <img src> or for
 * `window.open` / `<a download>`.
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${normalized}`;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: { error: string; type?: string; [key: string]: unknown },
  ) {
    super(body.error);
    this.name = "ApiError";
  }
}

/** HTTP statuses that don't represent a connectivity issue, even
 * though they're 4xx/5xx. 401/403 mean the user is logged out;
 * 404/422 are application-level problems. We only treat genuinely-
 * connectivity failures (status 0 = network unreachable, 5xx server
 * errors) as connectivity signals so the global banner stays meaningful. */
function _isConnectivityFailure(status: number): boolean {
  return status === 0 || status >= 500;
}

async function parseError(res: Response): Promise<{ error: string; type?: string }> {
  return res.json().catch(() => ({ error: `HTTP ${res.status}` }));
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(apiUrl(path), {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // Network-level failure (runtime unreachable). Surface as a
    // connectivity error, mirroring the old IPC-dead branch.
    publishConnectivity("api:error", { status: 0, path });
    throw new ApiError(0, { error: "Runtime unreachable" });
  }
  if (!res.ok) {
    const errBody = await parseError(res);
    if (_isConnectivityFailure(res.status)) {
      publishConnectivity("api:error", { status: res.status, path });
    } else {
      // Any non-connectivity response (auth, app errors) still proves
      // the runtime is reachable — clears stale "degraded" state.
      publishConnectivity("api:ok", { status: res.status, path });
    }
    throw new ApiError(res.status, errBody);
  }
  publishConnectivity("api:ok", { status: res.status, path });
  return res.json() as Promise<T>;
}

async function upload<T>(path: string, formData: FormData): Promise<T> {
  let res: Response;
  try {
    // Let the browser set the multipart Content-Type boundary.
    res = await fetch(apiUrl(path), { method: "POST", body: formData });
  } catch {
    publishConnectivity("api:error", { status: 0, path });
    throw new ApiError(0, { error: "Runtime unreachable" });
  }
  if (!res.ok) {
    const errBody = await parseError(res);
    throw new ApiError(res.status, errBody);
  }
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
  delete: <T>(path: string, body?: unknown) => request<T>("DELETE", path, body),
  upload: <T>(path: string, formData: FormData) => upload<T>(path, formData),
};

// --- SSE ---

export interface SseHandlers {
  onOpen?: () => void;
  onEvent?: (event: string, data: string) => void;
  onError?: (message: string, status?: number) => void;
  /** Fired when the stream dropped and the browser is retrying. Lets the UI
   * show "Reconnecting…" instead of going silent. */
  onReconnecting?: (delayMs: number) => void;
  onClose?: () => void;
}

export interface SubscribeSseOptions {
  /**
   * Set true for feature-specific streams whose UX is already covered by a
   * dedicated component (e.g. ``BrowserStatusBadge`` for
   * ``/browser/status/stream``). Their open/error events are NOT published to
   * the connectivity bus, so a routine keep-alive drop on a feature stream
   * doesn't flip the global "Reconnecting to runtime…" banner. Defaults to
   * false — every stream is runtime-critical unless its owner declares otherwise.
   */
  silentConnectivity?: boolean;
}

// Named SSE event types the backend emits (SSEResponse.send_event(..., event=...)
// and app.py `_send`). Default/unnamed events arrive via `onmessage`. EventSource
// only routes a named event to a matching addEventListener, so we register these
// explicitly; everything else lands on the default "message" handler.
const NAMED_SSE_EVENTS = ["status", "snapshot", "update"] as const;

/**
 * Subscribe to a runtime SSE stream. Returns a promise (kept for API
 * compatibility with the previous IPC-based client) that resolves to an
 * unsubscribe function. Named SSE events are delivered to `onEvent(name, data)`;
 * default events arrive as `onEvent("message", data)`.
 */
export async function subscribeSse(
  path: string,
  handlers: SseHandlers,
  options?: SubscribeSseOptions,
): Promise<() => void> {
  const silent = options?.silentConnectivity === true;
  const es = new EventSource(apiUrl(path));

  es.onopen = () => {
    if (!silent) publishConnectivity("sse:open", { path });
    handlers.onOpen?.();
  };

  es.onmessage = (e: MessageEvent) => {
    handlers.onEvent?.("message", e.data);
  };

  for (const name of NAMED_SSE_EVENTS) {
    es.addEventListener(name, (e) => {
      handlers.onEvent?.(name, (e as MessageEvent).data);
    });
  }

  es.onerror = () => {
    // EventSource auto-reconnects while readyState === CONNECTING.
    if (es.readyState === EventSource.CONNECTING) {
      if (!silent) publishConnectivity("sse:reconnecting", { path, delayMs: 0 });
      handlers.onReconnecting?.(0);
    } else {
      if (!silent) publishConnectivity("sse:error", { path });
      handlers.onError?.("sse_error");
    }
  };

  return () => {
    es.close();
    if (!silent) publishConnectivity("sse:close", { path });
  };
}
