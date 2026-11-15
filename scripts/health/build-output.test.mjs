import assert from "node:assert/strict";
import test from "node:test";
import { cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repo = fileURLToPath(new URL("../../", import.meta.url));
const config = (version, name) => ({ schemaVersion: 1, configVersion: version,
  lines: [{ id: "test", name, baseUrls: ["https://api.test/"] }] });

test("部署只读取生成结果，原始 sources.json 保持不变", () => {
  const root = mkdtempSync(join(tmpdir(), "source-health-build-"));
  try {
    cpSync(join(repo, "scripts"), join(root, "scripts"), { recursive: true });
    const raw = JSON.stringify(config(100, "原始基准"));
    writeFileSync(join(root, "sources.json"), raw);
    mkdirSync(join(root, "generated"));
    writeFileSync(join(root, "generated/sources.json"), JSON.stringify(config(101, "可用产物")));
    const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, "dist/sources.json"))).lines[0].name, "可用产物");
    assert.equal(readFileSync(join(root, "sources.json"), "utf8"), raw);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("首次没有生成产物时阻止部署，不能静默发布未经检查的基准", () => {
  const root = mkdtempSync(join(tmpdir(), "source-health-build-"));
  try {
    cpSync(join(repo, "scripts"), join(root, "scripts"), { recursive: true });
    writeFileSync(join(root, "sources.json"), JSON.stringify(config(100, "基准")));
    const result = spawnSync(process.execPath, ["scripts/build.mjs"], { cwd: root, encoding: "utf8" });
    assert.notEqual(result.status, 0);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
