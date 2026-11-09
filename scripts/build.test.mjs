import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scripts = dirname(fileURLToPath(import.meta.url));
const publicLine = { id: "public", name: "公共源", baseUrls: ["https://public.test/"] };
const nativeLine = { id: "juzi_shvip", name: "橘汁·VIP蓝光", protocol: "juzi-native" };

function checkConfig(line, defaultHomeLineId = "public") {
  const root = mkdtempSync(join(tmpdir(), "tvbox-config-check-"));
  try {
    mkdirSync(join(root, "scripts"));
    for (const name of readdirSync(scripts).filter((name) => name.endsWith(".mjs"))) {
      copyFileSync(join(scripts, name), join(root, "scripts", name));
    }
    writeFileSync(join(root, "sources.json"), JSON.stringify({
      schemaVersion: 1, configVersion: 2026110902, defaultHomeLineId, lines: [line, publicLine],
    }));
    return spawnSync(process.execPath, [join(root, "scripts/build.mjs"), "--check"], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("已内置橘汁渠道无需公开解析地址，也可作为默认源", () => {
  const result = checkConfig(nativeLine, nativeLine.id);
  assert.equal(result.status, 0, result.stderr);
});

test("未知橘汁渠道不能伪装为已内置解析器", () => {
  const result = checkConfig({ ...nativeLine, id: "juzi_unknown", baseUrls: ["https://unknown.test/"] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /未内置/);
});

test("橘汁渠道不能携带远程解析地址", () => {
  const result = checkConfig({ ...nativeLine, baseUrls: ["https://untrusted.test/"] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /baseUrls/);
});

test("橘汁保留ID不能被MacCms地址覆盖", () => {
  const result = checkConfig({ ...publicLine, id: nativeLine.id });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /juzi-native/);
});

test("协议密钥不能进入公开的橘汁元数据", () => {
  const result = checkConfig({ ...nativeLine, sharedKey: "test-not-a-secret" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sharedKey/);
});

test("普通MacCms源保留原有校验行为", () => {
  const result = checkConfig({ ...publicLine, id: "another" });
  assert.equal(result.status, 0, result.stderr);
});

test("错误ID类型返回校验错误，不中断校验器", () => {
  const result = checkConfig({ ...publicLine, id: 123 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /id: 只能包含/);
  assert.doesNotMatch(result.stderr, /TypeError/);
});
