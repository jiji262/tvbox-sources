#!/usr/bin/env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inspectApk } from "./apk-metadata.mjs";
import { createReleaseManifest } from "./release-manifest.mjs";
import { FLAVORS, isUpdateUrl } from "./updates.mjs";
import { verifyPublishedApk } from "./published-apk.mjs";

function options() {
  const string = { type: "string" };
  const boolean = { type: "boolean" };
  const { values } = parseArgs({ options: {
    flavor: string, apk: string, "apk-url": string, sdk: string, message: string,
    force: boolean, optional: boolean, "dry-run": boolean, "min-supported-version-code": string,
    changelog: { type: "string", multiple: true },
  } });
  if (!FLAVORS[values.flavor] || !values.apk || !isUpdateUrl(values["apk-url"])) {
    throw new Error("需要 --flavor modern|legacy --apk 本地安装包 --apk-url HTTPS下载地址");
  }
  const count = Number(!!values.force) + Number(!!values.optional) + Number(values["min-supported-version-code"] !== undefined);
  if (count !== 1) throw new Error("必须且只能选择 --optional、--force 或 --min-supported-version-code 数字");
  return values;
}

try {
  const values = options();
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const target = join(root, "updates", `${values.flavor}.json`);
  const previous = JSON.parse(readFileSync(target, "utf8"));
  const artifact = { ...inspectApk(resolve(values.apk), values.sdk), apkUrl: values["apk-url"] };
  const manifest = createReleaseManifest(previous, artifact, {
    flavor: values.flavor, mode: values.force ? "force" : values.optional ? "optional" : "minimum",
    minimum: Number(values["min-supported-version-code"]), message: values.message, changelog: values.changelog,
  });
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  if (values["dry-run"]) process.stdout.write(raw);
  else {
    await verifyPublishedApk(artifact);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, raw, { flag: "wx" });
    renameSync(temporary, target);
    console.log(`已生成 updates/${values.flavor}.json：${manifest.versionName}，最低版本 ${manifest.minSupportedVersionCode}，修订 ${manifest.policyRevision}`);
    console.log("请确认 APK 下载地址已可用，再提交并按既有流程部署。");
  }
} catch (error) {
  console.error(`发布清单生成失败：${error.message}`);
  process.exitCode = 1;
}
