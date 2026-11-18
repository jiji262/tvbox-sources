import { renameSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { inspectApk } from "./apk-metadata.mjs";
import { createDisabledManifest, createReleaseManifest } from "./release-manifest.mjs";
import { FLAVORS, isUpdateUrl } from "./updates.mjs";
import { verifyPublishedApk } from "./published-apk.mjs";

function options() {
  const string = { type: "string" };
  const boolean = { type: "boolean" };
  const { values } = parseArgs({ options: {
    flavor: string, apk: string, "apk-url": string, sdk: string, message: string,
    force: boolean, optional: boolean, disable: boolean, "dry-run": boolean,
    "min-supported-version-code": string,
    changelog: { type: "string", multiple: true },
  } });
  const count = Number(!!values.force) + Number(!!values.optional) +
    Number(!!values.disable) + Number(values["min-supported-version-code"] !== undefined);
  if (!FLAVORS[values.flavor] || count !== 1) {
    throw new Error("需要 --flavor modern|legacy，且只能选择 --optional、--force、--min-supported-version-code 数字 或 --disable");
  }
  if (values.disable) {
    if (values.apk || values["apk-url"] || values.changelog?.length) {
      throw new Error("--disable 模式保留历史 APK 元数据，无需传入 --apk、--apk-url 或 --changelog");
    }
    return values;
  }
  if (!values.apk || !isUpdateUrl(values["apk-url"])) {
    throw new Error("发布更新需要 --apk 本地安装包 与 --apk-url HTTPS下载地址");
  }
  return values;
}

try {
  const values = options();
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const target = join(root, "updates", `${values.flavor}.json`);
  const previous = JSON.parse(readFileSync(target, "utf8"));
  const artifact = values.disable ? null : { ...inspectApk(resolve(values.apk), values.sdk), apkUrl: values["apk-url"] };
  const manifest = values.disable
    ? createDisabledManifest(previous, { flavor: values.flavor, message: values.message })
    : createReleaseManifest(previous, artifact, {
      flavor: values.flavor, mode: values.force ? "force" : values.optional ? "optional" : "minimum",
      minimum: Number(values["min-supported-version-code"]), message: values.message, changelog: values.changelog,
    });
  const raw = `${JSON.stringify(manifest, null, 2)}\n`;
  if (values["dry-run"]) process.stdout.write(raw);
  else {
    if (artifact) await verifyPublishedApk(artifact);
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(temporary, raw, { flag: "wx" });
    renameSync(temporary, target);
    if (values.disable) {
      console.log(`已停用 updates/${values.flavor}.json：最低版本 0，修订 ${manifest.policyRevision}`);
    } else {
      console.log(`已生成 updates/${values.flavor}.json：${manifest.versionName}，最低版本 ${manifest.minSupportedVersionCode}，修订 ${manifest.policyRevision}`);
      console.log("请确认 APK 下载地址已可用，再提交并按既有流程部署。");
    }
  }
} catch (error) {
  console.error(`发布清单生成失败：${error.message}`);
  process.exitCode = 1;
}
