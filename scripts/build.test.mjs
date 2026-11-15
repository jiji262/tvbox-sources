import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scripts = dirname(fileURLToPath(import.meta.url));
const publicLine = { id: "public", name: "公共源", baseUrls: ["https://public.test/"] };
const nativeLine = { id: "juzi_shvip", name: "JZ·VIP蓝光", protocol: "juzi-native" };

function checkConfig(line, defaultHomeLineId = "public", extra = {}) {
  const root = mkdtempSync(join(tmpdir(), "tvbox-config-check-"));
  try {
    mkdirSync(join(root, "scripts"));
    cpSync(join(scripts, "../updates"), join(root, "updates"), { recursive: true });
    for (const name of readdirSync(scripts).filter((name) => name.endsWith(".mjs"))) {
      copyFileSync(join(scripts, name), join(root, "scripts", name));
    }
    writeFileSync(join(root, "sources.json"), JSON.stringify({
      schemaVersion: 1, configVersion: 2026110902, defaultHomeLineId, lines: [line, publicLine],
      ...extra,
    }));
    return spawnSync(process.execPath, [join(root, "scripts/build.mjs"), "--check"], { encoding: "utf8" });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("已内置 JZ 渠道无需公开解析地址，也可作为默认源", () => {
  const result = checkConfig(nativeLine, nativeLine.id);
  assert.equal(result.status, 0, result.stderr);
});

test("同协议的新 JZ 渠道无需预先编入 APK，也可作为默认源", () => {
  const result = checkConfig({ ...nativeLine, id: "juzi_remote_4k" }, "juzi_remote_4k");
  assert.equal(result.status, 0, result.stderr);
});

test("JZ 渠道必须使用非空且合法的渠道标识", () => {
  for (const id of ["juzi_", "juzi_-invalid", "other_channel"]) {
    const result = checkConfig({ ...nativeLine, id });
    assert.equal(result.status, 1, id);
    assert.match(result.stderr, /渠道标识/);
  }
});

test("JZ 渠道不能携带远程解析地址", () => {
  const result = checkConfig({ ...nativeLine, baseUrls: ["https://untrusted.test/"] });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /baseUrls/);
});

test("JZ 保留ID不能被MacCms地址覆盖", () => {
  const result = checkConfig({ ...publicLine, id: nativeLine.id });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /juzi-native/);
});

test("协议密钥不能进入公开的 JZ 元数据", () => {
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

test("JZ 共用发现入口只需配置一次且允许省略", () => {
  const result = checkConfig(nativeLine, nativeLine.id, {
    juzi: { bootstrapUrls: ["https://remote.test/discover.json"] },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(checkConfig(nativeLine).status, 0);
  assert.equal(checkConfig(nativeLine, "public", { juzi: {} }).status, 0);
});

test("JZ 发现入口拒绝 HTTP、地址凭据和片段", () => {
  for (const url of ["http://remote.test/config", "https://user:pass@remote.test/config", "https://remote.test/config#x"]) {
    const result = checkConfig(nativeLine, "public", { juzi: { bootstrapUrls: [url] } });
    assert.equal(result.status, 1, url);
    assert.match(result.stderr, /juzi.bootstrapUrls/);
  }
});

test("共用发现配置不能公开协议密钥", () => {
  const result = checkConfig(nativeLine, "public", {
    juzi: { bootstrapUrls: ["https://remote.test/config"], sharedKey: "not-a-secret" },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /sharedKey/);
});

test("JZ 发现入口拒绝错误类型、重复和过多地址", () => {
  const invalid = [null, [], { bootstrapUrls: "https://remote.test/config" },
    { bootstrapUrls: Array(2).fill("https://remote.test/config") },
    { bootstrapUrls: Array.from({ length: 11 }, (_, i) => `https://remote.test/${i}`) }];
  for (const juzi of invalid) {
    const result = checkConfig(nativeLine, "public", { juzi });
    assert.equal(result.status, 1, JSON.stringify(juzi));
    assert.match(result.stderr, /juzi/);
    assert.doesNotMatch(result.stderr, /TypeError/);
  }
});
