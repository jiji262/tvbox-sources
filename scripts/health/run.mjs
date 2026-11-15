import { readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { generateSnapshot, isScheduledDay } from "./generate.mjs";
import { collectResults } from "./runner.mjs";
import { probeMacCms } from "./maccms.mjs";
import { createJuziProbe } from "./juzi.mjs";
import { ProbeError } from "./http.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const path = (name) => join(root, name);
const optionalJson = (name) => existsSync(path(name)) ? JSON.parse(readFileSync(path(name), "utf8")) : null;

async function run() {
  execFileSync(process.execPath, [path("scripts/build.mjs"), "--check-bump"], { stdio: "inherit" });
  const raw = readFileSync(path("sources.json"), "utf8");
  const baseline = JSON.parse(raw);
  const previous = optionalJson("generated/sources.json");
  const previousHealth = optionalJson("generated/health.json");
  let native;
  if (baseline.lines.some((line) => line.enabled !== false && line.protocol === "juzi-native")) {
    const protocol = JSON.parse(process.env.JZ_PROTOCOL_CONFIG ?? "null");
    native = createJuziProbe(protocol, baseline.juzi);
    await native.prepare();
    await native.warmup();
  }
  const results = await collectResults(baseline.lines, (line, options) =>
    line.protocol === "juzi-native" ? native.probe(line, options) : probeMacCms(line, options));
  const now = new Date();
  const config = generateSnapshot({ baseline, results, previous, now });
  const health = makeHealth({ raw, config, results, previousHealth, now });
  mkdirSync(path("generated"), { recursive: true });
  atomicWrite("generated/sources.json", config);
  atomicWrite("generated/health.json", health);
  writeSummary(health);
}

function makeHealth({ raw, config, results, previousHealth, now }) {
  const previous = new Map((previousHealth?.results ?? []).map((row) => [row.id, row]));
  return {
    schemaVersion: 1, checkedAt: now.toISOString(), configVersion: config.configVersion,
    baselineSha256: createHash("sha256").update(raw).digest("hex"),
    node: process.env.GITHUB_ACTIONS ? "github-actions" : "local",
    available: results.filter((row) => row.status === "available").length,
    total: results.length,
    results: results.map((row) => ({ ...row, lastSuccessAt: row.status === "available"
      ? now.toISOString() : previous.get(row.id)?.lastSuccessAt ?? null })),
  };
}

function atomicWrite(name, value) {
  writeFileSync(path(name + ".tmp"), JSON.stringify(value, null, 2) + "\n", { mode: 0o644 });
  renameSync(path(name + ".tmp"), path(name));
}

function writeSummary(health) {
  const clean = (value) => String(value).replace(/[|\r\n<>]/g, " ");
  const rows = health.results.map((r) =>
    "| " + [r.id, r.name, r.status, r.stage ?? "-", r.code ?? "-", r.elapsedMs].map(clean).join(" | ") + " |");
  const summary = ["## 片源检测", "", "版本 " + health.configVersion + "，通过 " + health.available + "/" + health.total,
    "", "| ID | 名称 | 状态 | 环节 | 原因 | 耗时ms |", "| --- | --- | --- | --- | --- | --- |", ...rows, ""].join("\n");
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log("generated configVersion=" + health.configVersion + ", available=" + health.available + "/" + health.total);
}

try {
  if (process.argv.includes("--due")) {
    console.log("run=" + (process.env.GITHUB_EVENT_NAME !== "schedule" || isScheduledDay()));
  } else if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) await run();
} catch (error) {
  console.error(error instanceof ProbeError ? error.code : "health_check_failed; previous output preserved");
  process.exitCode = 1;
}
