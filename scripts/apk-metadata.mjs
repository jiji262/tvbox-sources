import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function androidTool(sdk, name) {
  const directory = join(sdk, "build-tools");
  const versions = readdirSync(directory).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const version = versions.find((value) => existsSync(join(directory, value, name)));
  if (!version) throw new Error(`Android SDK 缺少 ${name}，请使用 --sdk 指定 SDK 目录`);
  return join(directory, version, name);
}

export function parseApkMetadata(badging) {
  const name = badging.match(/package: name='([^']+)' versionCode='(\d+)' versionName='([^']+)'/);
  const sdk = badging.match(/^(?:minSdkVersion|sdkVersion):'(\d+)'/m);
  if (!name || !sdk) throw new Error("无法读取 APK 的包名、版本和最低系统版本");
  return { packageName: name[1], versionCode: Number(name[2]), versionName: name[3], minSdk: Number(sdk[1]) };
}

export function inspectApk(file, sdkDirectory) {
  const sdk = sdkDirectory || process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || join(homedir(), "Library/Android/sdk");
  const options = { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 };
  const metadata = parseApkMetadata(execFileSync(androidTool(sdk, "aapt2"), ["dump", "badging", file], options));
  const signed = execFileSync(androidTool(sdk, "apksigner"),
    ["verify", "--min-sdk-version", String(metadata.minSdk), "--print-certs", file], options);
  const certificates = [...signed.matchAll(/Signer #\d+ certificate SHA-256 digest: ([a-fA-F0-9]{64})/g)];
  if (certificates.length !== 1) throw new Error("发布 APK 必须有且仅有一个签名证书");
  const bytes = readFileSync(file);
  return { ...metadata, apkSize: bytes.length, apkSha256: createHash("sha256").update(bytes).digest("hex"),
    signingCertificateSha256: certificates[0][1].toLowerCase() };
}
