import { FLAVORS, validateUpdate, validateUpdateChange } from "./updates.mjs";

export function createReleaseManifest(previous, artifact, options) {
  if (!["optional", "force", "minimum"].includes(options.mode)) throw new Error("必须选择普通更新、全部强更或最低版本模式");
  const minimum = options.mode === "force" ? artifact.versionCode
    : options.mode === "minimum" ? options.minimum : previous.minSupportedVersionCode;
  const manifest = {
    schemaVersion: 1, enabled: true, policyRevision: previous.policyRevision + 1,
    ...artifact, minSupportedVersionCode: minimum, force: options.mode === "force",
    forceMessage: (options.message ?? previous.forceMessage ?? "").trim() ||
      (minimum > 0 ? "当前版本已不兼容，请更新后继续使用" : ""),
    changelog: options.changelog ?? [],
  };
  const errors = [...validateUpdate(manifest, options.flavor), ...validateUpdateChange(previous, manifest)];
  if (!FLAVORS[options.flavor] || errors.length) throw new Error(errors.join("\n") || "不支持的渠道");
  return manifest;
}

export function createDisabledManifest(previous, options) {
  if (!FLAVORS[options.flavor]) throw new Error("不支持的渠道");
  const manifest = {
    ...previous,
    schemaVersion: 1,
    enabled: false,
    policyRevision: previous.policyRevision + 1,
    minSupportedVersionCode: 0,
    force: false,
    forceMessage: (options.message ?? "").trim(),
  };
  const errors = [...validateUpdate(manifest, options.flavor), ...validateUpdateChange(previous, manifest)];
  if (errors.length) throw new Error(errors.join("\n"));
  return manifest;
}
