import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repository = join(dirname(fileURLToPath(import.meta.url)), "..");

function buildWith(manifest, inspect, prepare = () => {}) {
  const root = mkdtempSync(join(tmpdir(), "tvbox-updates-"));
  try {
    cpSync(join(repository, "scripts"), join(root, "scripts"), { recursive: true });
    cpSync(join(repository, "sources.json"), join(root, "sources.json"));
    cpSync(join(repository, "generated"), join(root, "generated"), { recursive: true });
    mkdirSync(join(root, "updates"));
    for (const flavor of ["modern", "legacy"]) {
      const value = { schemaVersion: 1, enabled: false, policyRevision: 1,
        minSupportedVersionCode: 0, force: false,
        packageName: flavor === "modern" ? "com.dangdang.tv" : "com.dangdang.tv.legacy",
        minSdk: flavor === "modern" ? 28 : 22, ...manifest[flavor] };
      writeFileSync(join(root, "updates", `${flavor}.json`), JSON.stringify(value));
    }
    assert.equal(spawnSync("git", ["init", "-q", root]).status, 0);
    prepare(root);
    const result = spawnSync(process.execPath, [join(root, "scripts/build.mjs")], { encoding: "utf8" });
    inspect(result, root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("构建发布两个默认关闭的更新入口，不生成虚假 APK", () => {
  buildWith({}, (result, root) => {
    assert.equal(result.status, 0, result.stderr);
    const modern = JSON.parse(readFileSync(join(root, "dist/updates/modern.json"), "utf8"));
    assert.equal(modern.enabled, false);
    assert.equal(modern.minSupportedVersionCode, 0);
    assert.equal(modern.apkUrl, undefined);
    assert.equal(JSON.parse(readFileSync(join(root, "dist/updates/legacy.json"), "utf8")).packageName,
      "com.dangdang.tv.legacy");
  });
});

test("错误强更策略阻止整个部署产物生成", () => {
  buildWith({ modern: { minSupportedVersionCode: 10314 } }, (result) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /minSupportedVersionCode/);
  });
});

test("双包更新清单不可交叉配置", () => {
  buildWith({ legacy: { packageName: "com.dangdang.tv" } }, (result) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /packageName/);
  });
});

test("默认部署构建拒绝未递增修订号的策略修改", () => {
  buildWith({}, (result) => {
    assert.equal(result.status, 1);
    assert.match(result.stderr, /policyRevision/);
  }, (root) => {
    assert.equal(spawnSync("git", ["add", "."], { cwd: root }).status, 0);
    assert.equal(spawnSync("git", ["-c", "user.name=Update Tests", "-c", "user.email=tests@example.test",
      "commit", "-qm", "baseline"], { cwd: root }).status, 0);
    const file = join(root, "updates/modern.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    writeFileSync(file, JSON.stringify({ ...manifest, forceMessage: "修改策略但忘记递增版本" }));
  });
});
