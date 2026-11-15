import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const FLAVORS = {
  modern: { packageName: "com.dangdang.tv", minSdk: 28 },
  legacy: { packageName: "com.dangdang.tv.legacy", minSdk: 22 },
};
const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_VERSION_CODE = 2_147_483_647;
const SHA256 = /^[a-fA-F0-9]{64}$/;

export function isUpdateUrl(value) {
  if (typeof value !== "string" || value !== value.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.hash;
  } catch {
    return false;
  }
}

export function validateUpdate(manifest, flavor) {
  const errors = [];
  const target = FLAVORS[flavor];
  if (!target || !manifest || Array.isArray(manifest) || typeof manifest !== "object") {
    return ["更新清单必须是受支持渠道的 JSON 对象"];
  }
  if (manifest.schemaVersion !== 1) errors.push("schemaVersion 必须为 1");
  if (typeof manifest.enabled !== "boolean") errors.push("enabled 必须为布尔值");
  if (!Number.isSafeInteger(manifest.policyRevision) || manifest.policyRevision <= 0) errors.push("policyRevision 必须为正整数");
  if (manifest.packageName !== target.packageName) errors.push(`packageName 必须为 ${target.packageName}`);
  if (manifest.minSdk !== target.minSdk) errors.push(`minSdk 必须为 ${target.minSdk}，不能强迫旧设备安装不兼容的更新`);
  if (typeof manifest.force !== "boolean") errors.push("force 必须为布尔值");
  const minimum = manifest.minSupportedVersionCode;
  if (!Number.isSafeInteger(minimum) || minimum < 0 || minimum > MAX_VERSION_CODE) errors.push("minSupportedVersionCode 必须为非负版本整数");
  if (!manifest.enabled) {
    if (minimum !== 0 || manifest.force !== false) errors.push("停用更新时 minSupportedVersionCode 必须为 0，force 必须为 false");
    if (manifest.versionCode !== undefined) validateRelease(manifest, errors);
    return errors;
  }
  validateRelease(manifest, errors);
  return errors;
}

function validateRelease(manifest, errors) {
  const version = manifest.versionCode;
  if (!Number.isSafeInteger(version) || version <= 0 || version > MAX_VERSION_CODE) errors.push("versionCode 无效");
  if (typeof manifest.versionName !== "string" || !manifest.versionName.trim()) errors.push("versionName 不能为空");
  if (manifest.minSupportedVersionCode > version) errors.push("minSupportedVersionCode 不能高于 versionCode");
  if (manifest.force && manifest.minSupportedVersionCode !== version) errors.push("force=true 时最低版本必须等于 versionCode");
  if (manifest.minSupportedVersionCode > 0 && (typeof manifest.forceMessage !== "string" || !manifest.forceMessage.trim())) {
    errors.push("强更必须提供 forceMessage");
  }
  if (!isUpdateUrl(manifest.apkUrl)) errors.push("apkUrl 必须为不含凭据和片段的 HTTPS 地址");
  if (typeof manifest.apkSha256 !== "string" || !SHA256.test(manifest.apkSha256)) errors.push("apkSha256 必须为 64 位 SHA-256");
  if (!Number.isSafeInteger(manifest.apkSize) || manifest.apkSize <= 0) errors.push("apkSize 必须为正整数");
  if (typeof manifest.signingCertificateSha256 !== "string" || !SHA256.test(manifest.signingCertificateSha256)) {
    errors.push("signingCertificateSha256 必须为 APK 签名证书的 SHA-256");
  }
  if (!Array.isArray(manifest.changelog) || manifest.changelog.some((line) => typeof line !== "string" || !line.trim())) {
    errors.push("changelog 必须为非空字符串组成的数组");
  }
}

export function validateUpdateChange(previous, current) {
  if (JSON.stringify(previous) === JSON.stringify(current)) return [];
  const errors = [];
  if (current.policyRevision <= previous.policyRevision) errors.push("清单变化时 policyRevision 必须递增，撤销强更也一样");
  if (previous.versionCode !== undefined) {
    if (!Number.isSafeInteger(current.versionCode)) errors.push("停用更新时必须保留历史 APK 元数据");
    if (current.versionCode < previous.versionCode) errors.push("versionCode 不能降低；回滚请只降低最低版本");
    if (current.signingCertificateSha256?.toLowerCase() !== previous.signingCertificateSha256?.toLowerCase()) {
      errors.push("签名证书不能改变，否则已装应用无法覆盖升级");
    }
    if (current.versionCode === previous.versionCode && current.apkSha256?.toLowerCase() !== previous.apkSha256?.toLowerCase()) {
      errors.push("同一 versionCode 不能替换 APK 内容");
    }
  }
  return errors;
}

function previousManifest(root, file, current) {
  const git = (args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try { git(["rev-parse", "--git-dir"]); } catch { throw new Error("部署构建需要 Git 历史来验证更新策略"); }
  const committed = readCommittedManifest(git, "HEAD", file);
  if (committed === null) return null;
  if (JSON.stringify(committed) !== JSON.stringify(current)) return committed;
  let hasParent = false;
  try { git(["rev-parse", "--verify", "HEAD~1"]); hasParent = true; } catch { /* 首个提交没有父版本。 */ }
  if (!hasParent && git(["rev-parse", "--is-shallow-repository"]) === "true") {
    throw new Error("Git 历史不足，请至少获取两个提交后部署");
  }
  return hasParent ? readCommittedManifest(git, "HEAD~1", file) : null;
}

function readCommittedManifest(git, ref, file) {
  let raw;
  try { raw = git(["show", `${ref}:${file}`]); } catch { return null; }
  return JSON.parse(raw);
}

export function readUpdates(root, { checkBump = false } = {}) {
  const manifests = [];
  const errors = [];
  for (const flavor of Object.keys(FLAVORS)) {
    const file = `updates/${flavor}.json`;
    try {
      const raw = readFileSync(join(root, file));
      if (raw.length > MAX_MANIFEST_BYTES) throw new Error("清单超过 64KiB");
      const manifest = JSON.parse(raw.toString("utf8"));
      const problems = validateUpdate(manifest, flavor);
      if (checkBump && problems.length === 0) {
        const previous = previousManifest(root, file, manifest);
        if (previous) problems.push(...validateUpdateChange(previous, manifest));
      }
      errors.push(...problems.map((message) => `${file}: ${message}`));
      manifests.push({ file, raw });
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
    }
  }
  return { manifests, errors };
}

export function writeUpdates(dist, manifests) {
  mkdirSync(join(dist, "updates"), { recursive: true });
  for (const { file, raw } of manifests) writeFileSync(join(dist, file), raw);
}
