import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { verifyPublishedApk } from "./published-apk.mjs";

const bytes = Buffer.from("signed-apk-fixture");
const artifact = { apkUrl: "https://downloads.test/app.apk", apkSize: bytes.length,
  apkSha256: createHash("sha256").update(bytes).digest("hex") };

test("发布前确认远端 APK 与本地签名产物完全一致", async () => {
  await verifyPublishedApk(artifact, async () => new Response(bytes));
  await assert.rejects(verifyPublishedApk(artifact, async () => new Response(Buffer.from("different-content!"))), /不一致/);
});

test("远端不可达或返回过大文件时不能发布强更", async () => {
  await assert.rejects(verifyPublishedApk(artifact, async () => new Response(null, { status: 404 })), /404/);
  await assert.rejects(verifyPublishedApk(artifact, async () => new Response(Buffer.alloc(100))), /超过/);
});

test("HTTPS 跳转可验证，HTTP 降级和循环跳转被拒绝", async () => {
  const redirect = (location) => new Response(null, { status: 302, headers: { location } });
  await verifyPublishedApk(artifact, async (url) => url === artifact.apkUrl ? redirect("https://cdn.test/app.apk") : new Response(bytes));
  await assert.rejects(verifyPublishedApk(artifact, async () => redirect("http://cdn.test/app.apk")), /HTTPS/);
  await assert.rejects(verifyPublishedApk(artifact, async () => redirect("https://cdn.test/app.apk")), /跳转/);
});
