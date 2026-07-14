/**
 * Small HTTP helpers shared by the hypervisor providers (Proxmox, vSphere).
 *
 * Both typically expose self-signed TLS endpoints, so we allow opting out of
 * certificate verification via an undici Agent configured with
 * `connect: { rejectUnauthorized: false }`.
 */
import { Agent, request } from 'undici';

export type HttpOptions = {
  /** When true, skip TLS certificate verification. */
  insecureTls: boolean;
  headers?: Record<string, string>;
  /** Optional request timeout in milliseconds. */
  timeoutMs?: number;
};

/**
 * Issue an HTTPS request using undici with optional self-signed TLS support.
 * Returns the parsed JSON body or null when empty.
 */
export async function httpRequest<T = unknown>(
  url: string,
  method: string,
  body: unknown,
  options: HttpOptions,
): Promise<T> {
  const dispatcher = new Agent({
    connect: options.insecureTls ? { rejectUnauthorized: false } : undefined,
  });

  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  let payload: string | undefined;
  if (body !== undefined && body !== null) {
    payload = typeof body === 'string' ? body : JSON.stringify(body);
    if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
  }

  try {
    const response = await request(url, {
      method,
      headers,
      body: payload,
      headersTimeout: options.timeoutMs ?? 30_000,
      bodyTimeout: options.timeoutMs ?? 30_000,
      dispatcher,
    });
    const text = await response.body.text();
    if (response.statusCode === undefined || response.statusCode >= 400) {
      throw new Error(`HTTP ${response.statusCode} for ${method} ${url}: ${text.slice(0, 300)}`);
    }
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return text as unknown as T;
    }
  } finally {
    await dispatcher.close();
  }
}

/**
 * Build a base URL from a raw host (which may or may not include the scheme).
 */
export function normalizeBaseUrl(host: string, defaultPort?: number): string {
  let value = host.trim();
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  const url = new URL(value);
  if (!url.port && defaultPort) url.port = String(defaultPort);
  return url.toString().replace(/\/$/, '');
}
