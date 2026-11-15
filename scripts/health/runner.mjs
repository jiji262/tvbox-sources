import { ProbeError } from "./http.mjs";

const CONCURRENCY = 3;
const SOURCE_TIMEOUT_MS = 30_000;

export async function collectResults(lines, probe) {
  const results = new Array(lines.length);
  let next = 0;
  const worker = async () => {
    while (next < lines.length) {
      const index = next++;
      results[index] = await checkLine(lines[index], probe);
      console.log(JSON.stringify(results[index]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, lines.length) }, worker));
  return results;
}

async function checkLine(line, probe) {
  const row = { id: line.id, name: line.name, protocol: line.protocol ?? "maccms-json" };
  if (line.enabled === false) return { ...row, status: "disabled", elapsedMs: 0 };
  const start = Date.now();
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort(); reject(new ProbeError("request", "source_timeout"));
      }, SOURCE_TIMEOUT_MS);
    });
    const result = await Promise.race([probe(line, { signal: controller.signal }), timeout]);
    return { ...row, status: "available", stage: "media", elapsedMs: Date.now() - start,
      ...(result.healthyUrls ? { healthyUrls: result.healthyUrls } : {}) };
  } catch (error) {
    return { ...row, status: "unavailable", stage: error instanceof ProbeError ? error.stage : "request",
      code: error instanceof ProbeError ? error.code : "network_or_format_error", elapsedMs: Date.now() - start };
  } finally { clearTimeout(timer); }
}
