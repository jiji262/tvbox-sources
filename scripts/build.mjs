#!/usr/bin/env node
// Validates sources.json and writes the static site to dist/.
// A failed validation exits non-zero, so Vercel keeps serving the previous deployment.
//
// Usage:
//   node scripts/build.mjs               validate + build dist/
//   node scripts/build.mjs --check       validate only
//   node scripts/build.mjs --check-bump  also require configVersion to grow when sources.json changes (needs git history)

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(root, "sources.json");
const distDir = join(root, "dist");
const args = new Set(process.argv.slice(2));

const SUPPORTED_SCHEMA_VERSION = 1;
const MAX_BYTES = 512 * 1024;
const MAX_LINES = 200;
const KNOWN_PROTOCOLS = new Set(["maccms-json"]);
const ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

const errors = [];
const warnings = [];
const fail = (message) => errors.push(message);
const warn = (message) => warnings.push(message);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkUrl(value, where, { httpsOnly = false, allowQuery = true } = {}) {
  if (typeof value !== "string" || value.trim() !== value || value === "") {
    fail(`${where}: 必须是非空字符串且不能有首尾空格`);
    return;
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${where}: 不是合法 URL：${value}`);
    return;
  }
  const allowed = httpsOnly ? ["https:"] : ["http:", "https:"];
  if (!allowed.includes(url.protocol)) {
    fail(`${where}: 只允许 ${allowed.join(" / ")}：${value}`);
  }
  if (!allowQuery && (url.search || url.hash)) {
    fail(`${where}: 不能带 ? 查询参数或 # 片段：${value}`);
  }
}

function checkUrlList(value, where, options) {
  if (!Array.isArray(value)) {
    fail(`${where}: 必须是数组`);
    return [];
  }
  value.forEach((item, index) => checkUrl(item, `${where}[${index}]`, options));
  const duplicated = value.filter((item, index) => value.indexOf(item) !== index);
  if (duplicated.length > 0) fail(`${where}: 存在重复地址：${[...new Set(duplicated)].join(", ")}`);
  return value;
}

function checkPositiveIntList(value, where) {
  if (!Array.isArray(value) || value.some((item) => !Number.isInteger(item) || item <= 0)) {
    fail(`${where}: 必须是正整数数组`);
  }
}

function checkTypeId(value, where) {
  if (!Number.isInteger(value) || value < 0) {
    fail(`${where}: 必须是 >= 0 的整数（0 表示首页“全部”不按分类过滤）`);
  }
}

function validate(config) {
  if (!isPlainObject(config)) {
    fail("根节点必须是 JSON 对象");
    return;
  }
  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    fail(`schemaVersion 必须是 ${SUPPORTED_SCHEMA_VERSION}；新结构需要先发布支持它的 APK`);
  }
  if (!Number.isSafeInteger(config.configVersion) || config.configVersion <= 0) {
    fail("configVersion 必须是正整数，建议使用 YYYYMMDDNN，例如 2026110901");
  } else if (!/^\d{10}$/.test(String(config.configVersion))) {
    warn("configVersion 建议使用 10 位 YYYYMMDDNN 格式");
  }
  if (config.updatedAt !== undefined && (typeof config.updatedAt !== "string" || Number.isNaN(Date.parse(config.updatedAt)))) {
    fail("updatedAt 必须是 ISO 8601 时间字符串");
  }
  if (config.configUrls !== undefined) {
    const urls = checkUrlList(config.configUrls, "configUrls", { httpsOnly: true });
    if (urls.length > 10) fail("configUrls 最多 10 个");
  }

  const defaults = config.lineDefaults ?? {};
  if (!isPlainObject(defaults)) fail("lineDefaults 必须是对象");
  if (defaults.hiddenCategoryIds !== undefined) checkPositiveIntList(defaults.hiddenCategoryIds, "lineDefaults.hiddenCategoryIds");
  if (defaults.defaultTypeId !== undefined) checkTypeId(defaults.defaultTypeId, "lineDefaults.defaultTypeId");

  const lines = config.lines;
  if (!Array.isArray(lines) || lines.length === 0) {
    fail("lines 必须是非空数组");
    return;
  }
  if (lines.length > MAX_LINES) fail(`lines 最多 ${MAX_LINES} 条`);

  const ids = new Set();
  const enabledIds = new Set();
  lines.forEach((line, index) => {
    const where = `lines[${index}]${line && typeof line.id === "string" ? `(${line.id})` : ""}`;
    if (!isPlainObject(line)) {
      fail(`${where}: 必须是对象`);
      return;
    }
    if (typeof line.id !== "string" || !ID_PATTERN.test(line.id)) {
      fail(`${where}.id: 只能包含字母、数字、_ . -，长度 1-64`);
    } else if (line.id.startsWith("custom_")) {
      fail(`${where}.id: custom_ 前缀保留给用户在电视上添加的自定义接口`);
    } else if (ids.has(line.id)) {
      fail(`${where}.id: 重复的线路 id`);
    } else {
      ids.add(line.id);
    }
    if (typeof line.name !== "string" || line.name.trim() === "") fail(`${where}.name: 不能为空`);
    const protocol = line.protocol ?? "maccms-json";
    if (!KNOWN_PROTOCOLS.has(protocol)) {
      warn(`${where}.protocol: ${protocol} 不是当前 APK 支持的协议，旧版 APK 会跳过该线路`);
    }
    const baseUrls = checkUrlList(line.baseUrls, `${where}.baseUrls`, { allowQuery: false });
    if (baseUrls.length === 0) fail(`${where}.baseUrls: 至少需要一个地址`);
    for (const key of ["enabled", "searchable"]) {
      if (line[key] !== undefined && typeof line[key] !== "boolean") fail(`${where}.${key}: 必须是 true 或 false`);
    }
    if (line.hiddenCategoryIds !== undefined) checkPositiveIntList(line.hiddenCategoryIds, `${where}.hiddenCategoryIds`);
    if (line.defaultTypeId !== undefined) checkTypeId(line.defaultTypeId, `${where}.defaultTypeId`);
    if (line.enabled !== false && KNOWN_PROTOCOLS.has(protocol) && typeof line.id === "string") enabledIds.add(line.id);
  });
  if (enabledIds.size === 0) fail("至少需要一条 enabled 且协议受支持的线路");
  if (config.defaultHomeLineId !== undefined && !enabledIds.has(config.defaultHomeLineId)) {
    fail(`defaultHomeLineId(${config.defaultHomeLineId}) 必须指向一条已启用的线路`);
  }

  if (config.contentFilter !== undefined) {
    const keywords = config.contentFilter?.blockedKeywords;
    if (keywords !== undefined && (!Array.isArray(keywords) || keywords.some((item) => typeof item !== "string" || item.trim() === ""))) {
      fail("contentFilter.blockedKeywords 必须是非空字符串数组");
    }
  }
  if (config.live !== undefined && config.live.sourceUrls !== undefined) {
    checkUrlList(config.live.sourceUrls, "live.sourceUrls");
  }
  if (config.platformLive !== undefined && config.platformLive.serviceUrl !== undefined && config.platformLive.serviceUrl !== "") {
    checkUrl(config.platformLive.serviceUrl, "platformLive.serviceUrl");
  }
}

function previousCommittedConfig() {
  try {
    const raw = execFileSync("git", ["show", "HEAD~1:sources.json"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function checkVersionBump(config) {
  const previous = previousCommittedConfig();
  if (previous === null) {
    warn("没有可比较的上一版提交，跳过 configVersion 递增检查");
    return;
  }
  const { configVersion: _a, updatedAt: _b, ...currentBody } = config;
  const { configVersion: _c, updatedAt: _d, ...previousBody } = previous;
  const changed = JSON.stringify(currentBody) !== JSON.stringify(previousBody);
  if (changed && !(config.configVersion > previous.configVersion)) {
    fail(`sources.json 内容已修改，但 configVersion 没有增大（上一版 ${previous.configVersion}）`);
  } else if (config.configVersion < previous.configVersion) {
    fail(`configVersion 不能变小（上一版 ${previous.configVersion}）；回滚时也要使用更大的版本号`);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function renderIndex(config) {
  const enabled = config.lines.filter((line) => line.enabled !== false);
  const rows = config.lines
    .map((line) => `<tr><td>${escapeHtml(line.id)}</td><td>${escapeHtml(line.name)}</td><td>${line.enabled === false ? "停用" : "启用"}</td><td>${line.baseUrls.length}</td></tr>`)
    .join("\n");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>TVBox 影视源配置</title>
<style>
  body { font: 15px/1.6 system-ui, -apple-system, "PingFang SC", sans-serif; margin: 2rem auto; max-width: 760px; padding: 0 1rem; color: #1f2328; }
  code { background: #f2f4f7; padding: 0.1rem 0.35rem; border-radius: 4px; }
  table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
  th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid #e5e7eb; }
</style>
</head>
<body>
<h1>TVBox 影视源配置</h1>
<p>配置文件：<a href="/sources.json"><code>/sources.json</code></a></p>
<p>版本 <code>${escapeHtml(config.configVersion)}</code> · 更新于 ${escapeHtml(config.updatedAt ?? "-")} · 启用 ${enabled.length} / ${config.lines.length} 条线路</p>
<table>
<thead><tr><th>ID</th><th>名称</th><th>状态</th><th>地址数</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

const raw = readFileSync(sourcePath);
if (raw.length > MAX_BYTES) fail(`sources.json 超过 ${MAX_BYTES} 字节，APK 会拒绝下载`);
if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) fail("sources.json 不能带 UTF-8 BOM");

let config = null;
try {
  config = JSON.parse(raw.toString("utf8"));
} catch (error) {
  fail(`JSON 解析失败：${error.message}`);
}
if (config !== null) {
  validate(config);
  if (args.has("--check-bump") && errors.length === 0) checkVersionBump(config);
}

warnings.forEach((message) => console.warn(`warning: ${message}`));
if (errors.length > 0) {
  errors.forEach((message) => console.error(`error: ${message}`));
  console.error(`\nsources.json 校验失败（${errors.length} 个错误），未生成部署产物。`);
  process.exit(1);
}

const enabledCount = config.lines.filter((line) => line.enabled !== false).length;
console.log(`sources.json OK: configVersion=${config.configVersion}, lines=${config.lines.length}, enabled=${enabledCount}`);

if (!args.has("--check") && !args.has("--check-bump")) {
  rmSync(distDir, { recursive: true, force: true });
  mkdirSync(distDir, { recursive: true });
  writeFileSync(join(distDir, "sources.json"), raw);
  writeFileSync(join(distDir, "index.html"), renderIndex(config));
  console.log(`built ${join("dist", "sources.json")} and ${join("dist", "index.html")}`);
}
