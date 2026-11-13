const NATIVE_IDS = new Set([
  "juzi_shvip", "juzi_newxfyun", "juzi_tocyyds", "juzi_KZNB", "juzi_qq",
  "juzi_qiyi", "juzi_youku", "juzi_bilibili", "juzi_mgtv", "juzi_vod_1080",
]);
const METADATA_FIELDS = new Set([
  "id", "name", "protocol", "enabled", "searchable", "hiddenCategoryIds", "defaultTypeId",
]);

// 原生适配器的地址和密钥仅在 APK 中；公开配置只包含渠道元数据。
export function validateJuziLine(line, where, fail) {
  if (!NATIVE_IDS.has(line.id)) fail(`${where}.id: APK 未内置此 JZ 渠道，需先更新 APK`);
  for (const key of Object.keys(line)) {
    if (!METADATA_FIELDS.has(key)) fail(`${where}.${key}: juzi-native 只允许线路元数据，不能公开地址或协议配置`);
  }
}
