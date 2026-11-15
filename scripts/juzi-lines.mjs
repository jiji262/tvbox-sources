const CHANNEL_ID_PATTERN = /^juzi_([A-Za-z0-9_][A-Za-z0-9_.-]{0,58})$/;
const MAX_BOOTSTRAP_URLS = 10;
const METADATA_FIELDS = new Set([
  "id", "name", "protocol", "enabled", "searchable", "hiddenCategoryIds", "defaultTypeId",
]);

// 同协议渠道由远端管理；地址发现共用一份配置，密钥仍留在 APK。
export function validateJuziLine(line, where, fail) {
  if (typeof line.id !== "string" || !CHANNEL_ID_PATTERN.test(line.id)) {
    fail(`${where}.id: JZ 渠道标识必须为 juzi_ 加非空渠道 ID，首字符为字母、数字或下划线`);
  }
  for (const key of Object.keys(line)) {
    if (!METADATA_FIELDS.has(key)) fail(`${where}.${key}: juzi-native 只允许线路元数据，不能公开地址或协议配置`);
  }
}

export function validateJuziDiscovery(juzi, fail) {
  if (juzi === null || typeof juzi !== "object" || Array.isArray(juzi)) {
    fail("juzi 必须是对象");
    return;
  }
  for (const key of Object.keys(juzi)) {
    if (key !== "bootstrapUrls") fail(`juzi.${key}: 只允许 bootstrapUrls，协议密钥不能进入公开配置`);
  }
  const urls = juzi.bootstrapUrls ?? [];
  if (!Array.isArray(urls)) {
    fail("juzi.bootstrapUrls 必须是数组");
    return;
  }
  if (urls.length > MAX_BOOTSTRAP_URLS) fail(`juzi.bootstrapUrls 最多 ${MAX_BOOTSTRAP_URLS} 个`);
  if (new Set(urls).size !== urls.length) fail("juzi.bootstrapUrls 不能重复");
  for (const value of urls) {
    let url;
    try { url = new URL(value); } catch { /* 统一返回校验错误，不输出配置内容。 */ }
    if (typeof value !== "string" || value.trim() !== value || !url || url.protocol !== "https:"
      || url.username || url.password || value.includes("#")) {
      fail("juzi.bootstrapUrls 只允许无凭据、无片段的 HTTPS 地址");
    }
  }
}
