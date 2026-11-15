import { isIP } from "node:net";

export const MEDIA_BYTES = 64 * 1024;
const JSON_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 6000;
const MAX_REDIRECTS = 3;

export class ProbeError extends Error {
  constructor(stage, code) { super(code); this.stage = stage; this.code = code; }
}

export function safeUrl(value) {
  const url = new URL(value);
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  const privateIp = /^(0\.|10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host);
  const privateV6 = isIP(host) === 6 && (/^(::|f[cd]|fe[89ab])/.test(host) || host.includes("ffff:"));
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password
    || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")
    || privateIp || privateV6) throw new ProbeError("request", "unsafe_url");
  return url;
}

export async function request(value, options = {}) {
  let url = safeUrl(value);
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)].filter(Boolean));
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    const response = await fetch(url, {
      method: options.body ? "POST" : "GET", body: options.body,
      headers: { "User-Agent": "DangDangTV-SourceHealth/1", ...options.headers },
      redirect: "manual", signal,
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      if (options.body || !response.headers.get("location")) throw new ProbeError("request", "redirect_rejected");
      url = safeUrl(new URL(response.headers.get("location"), url));
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProbeError("request", "http_" + response.status);
    }
    const bytes = await readLimited(response, options.limit ?? JSON_BYTES);
    return { bytes, status: response.status, url: url.toString() };
  }
  throw new ProbeError("request", "too_many_redirects");
}

async function readLimited(response, limit) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (size < limit) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = value.subarray(0, limit - size);
      chunks.push(chunk); size += chunk.length;
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
