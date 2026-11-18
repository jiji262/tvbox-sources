import assert from "node:assert/strict";
import test from "node:test";
import { createDisabledManifest, createReleaseManifest } from "./release-manifest.mjs";
import { validateUpdate, validateUpdateChange } from "./updates.mjs";

const previous = { schemaVersion: 1, enabled: false, policyRevision: 1, packageName: "com.dangdang.tv",
  minSdk: 28, minSupportedVersionCode: 0, force: false };
const artifact = { packageName: "com.dangdang.tv", minSdk: 28, versionCode: 10320, versionName: "1.3.20",
  apkUrl: "https://downloads.test/modern.apk", apkSha256: "a".repeat(64), apkSize: 123,
  signingCertificateSha256: "b".repeat(64) };

test("发布时明确选择普通更新或全部强更", () => {
  const optional = createReleaseManifest(previous, artifact, { flavor: "modern", mode: "optional" });
  assert.equal(optional.minSupportedVersionCode, 0);
  assert.equal(optional.force, false);
  assert.equal(optional.policyRevision, 2);
  const required = createReleaseManifest(previous, artifact, { flavor: "modern", mode: "force", message: "请升级" });
  assert.equal(required.minSupportedVersionCode, 10320);
  assert.equal(required.force, true);
  assert.equal(required.forceMessage, "请升级");
});

test("普通发布保留既有最低版本，显式设零才撤销强更", () => {
  const old = createReleaseManifest(previous, { ...artifact, versionCode: 10314 }, { flavor: "modern", mode: "force" });
  const optional = createReleaseManifest(old, artifact, { flavor: "modern", mode: "optional" });
  assert.equal(optional.minSupportedVersionCode, 10314);
  const revoked = createReleaseManifest(optional, artifact, { flavor: "modern", mode: "minimum", minimum: 0 });
  assert.equal(revoked.minSupportedVersionCode, 0);
  assert.equal(revoked.policyRevision, 4);
  assert.equal(revoked.force, false);
});

test("发布拒绝错误渠道、不兼容系统、签名更换和版本倒退", () => {
  const old = createReleaseManifest(previous, artifact, { flavor: "modern", mode: "optional" });
  const invalid = [{ packageName: "com.dangdang.tv.legacy" }, { minSdk: 29 },
    { signingCertificateSha256: "c".repeat(64) }, { versionCode: 10319 }, { apkSha256: "d".repeat(64) }];
  for (const change of invalid) {
    assert.throws(() => createReleaseManifest(old, { ...artifact, ...change }, { flavor: "modern", mode: "force" }));
  }
});

test("不合法地址、哈希、阈值和修订号不能进入部署", () => {
  const valid = createReleaseManifest(previous, artifact, { flavor: "modern", mode: "optional" });
  const invalid = [{ apkUrl: "http://downloads.test/a.apk" }, { apkUrl: "https://user:secret@downloads.test/a.apk" },
    { apkSha256: "bad" }, { minSupportedVersionCode: 10321 }, { policyRevision: 0 }];
  for (const change of invalid) assert.ok(validateUpdate({ ...valid, ...change }, "modern").length > 0);
  assert.ok(validateUpdateChange(valid, { ...valid, minSupportedVersionCode: 10314 }).length > 0);
});

test("未选择发布模式或者超出发布版本的最低版本被拒绝", () => {
  assert.throws(() => createReleaseManifest(previous, artifact, { flavor: "modern" }));
  assert.throws(() => createReleaseManifest(previous, artifact, { flavor: "modern", mode: "minimum", minimum: 10321 }));
});

test("停用后重新发布仍须保持版本与签名兼容", () => {
  const enabled = createReleaseManifest(previous, artifact, { flavor: "modern", mode: "force" });
  const disabled = { ...enabled, enabled: false, force: false, minSupportedVersionCode: 0, policyRevision: 3 };
  for (const change of [{ versionCode: 10319 }, { versionCode: 10321, signingCertificateSha256: "c".repeat(64) }]) {
    assert.throws(() => createReleaseManifest(disabled, { ...artifact, ...change }, { flavor: "modern", mode: "force" }));
  }
  assert.ok(validateUpdateChange(enabled, { ...previous, policyRevision: 3 }).length > 0,
    "停用时不能删除用于约束后续升级的 APK 元数据");
});

test("一键停用更新自动清除强更阈值、保留历史签名与版本元数据并递增修订号", () => {
  const enabled = createReleaseManifest(previous, artifact, {
    flavor: "modern", mode: "force", message: "请升级", changelog: ["修复问题"],
  });
  const disabled = createDisabledManifest(enabled, { flavor: "modern" });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.force, false);
  assert.equal(disabled.minSupportedVersionCode, 0);
  assert.equal(disabled.policyRevision, enabled.policyRevision + 1);
  assert.equal(disabled.versionCode, enabled.versionCode);
  assert.equal(disabled.signingCertificateSha256, enabled.signingCertificateSha256);
  assert.deepEqual(validateUpdate(disabled, "modern"), []);
  assert.deepEqual(validateUpdateChange(enabled, disabled), []);
});
