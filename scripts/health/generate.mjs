const DAY_MS = 24 * 60 * 60 * 1000;
const CONFIG_URLS = [
  "https://tv.navs.dpdns.org/sources.json",
  "https://raw.githubusercontent.com/jiji262/tvbox-sources/main/generated/sources.json",
  "https://cdn.jsdelivr.net/gh/jiji262/tvbox-sources@main/generated/sources.json",
];

export function isScheduledDay(now = new Date()) {
  return Math.floor(now.getTime() / DAY_MS) % 2 === 0;
}

export function generateSnapshot({ baseline, results, previous, now = new Date() }) {
  const byId = new Map(results.map((result) => [result.id, result]));
  if (byId.size !== baseline.lines.length || results.length !== baseline.lines.length
    || baseline.lines.some((line) => !byId.has(line.id))) throw new Error("检测结果不完整");
  const config = structuredClone(baseline);
  config.lines = config.lines.map((line) => checkedLine(line, byId.get(line.id)));
  const available = config.lines.filter((line) => line.enabled);
  if (!available.length) throw new Error("全部线路检测失败，保留上一份有效配置");
  const selected = available.find((line) => line.id === baseline.defaultHomeLineId)
    ?? available.find((line) => line.id !== "juzi_vod_1080") ?? available[0];
  config.defaultHomeLineId = selected.id;
  config.configVersion = Math.max(baseline.configVersion, previous?.configVersion ?? 0) + 1;
  if (!Number.isSafeInteger(config.configVersion)) throw new Error("配置版本溢出");
  config.updatedAt = now.toISOString();
  config.configUrls = CONFIG_URLS;
  return config;
}

function checkedLine(line, result) {
  if (!["available", "unavailable", "disabled"].includes(result.status)) throw new Error("未知检测状态");
  const checked = { ...line, enabled: line.enabled !== false && result.status === "available" };
  if (checked.enabled && result.healthyUrls?.length) {
    if (result.healthyUrls.some((url) => !line.baseUrls?.includes(url))) throw new Error("检测结果包含未知接口");
    checked.baseUrls = result.healthyUrls;
  }
  return checked;
}
