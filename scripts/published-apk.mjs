import { createHash } from "node:crypto";
import { isUpdateUrl } from "./updates.mjs";

const MAX_REDIRECTS = 5;
const DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export async function verifyPublishedApk(artifact, fetcher = fetch) {
  let url = artifact.apkUrl;
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects++) {
    if (!isUpdateUrl(url)) throw new Error("APK 下载及跳转必须使用不含凭据的 HTTPS");
    const response = await fetcher(url, { redirect: "manual", signal });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel();
      const location = response.headers.get("location");
      if (!location) throw new Error("APK 下载跳转缺少目标地址");
      url = new URL(location, url).href;
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`APK 下载地址不可用：HTTP ${response.status}`);
    await verifyPayload(response.body, artifact);
    return;
  }
  throw new Error("APK 下载跳转次数过多");
}

async function verifyPayload(body, artifact) {
  const hash = createHash("sha256");
  let received = 0;
  for await (const bytes of body) {
    received += bytes.length;
    if (received > artifact.apkSize) throw new Error("远端 APK 超过本地文件大小");
    hash.update(bytes);
  }
  if (received !== artifact.apkSize || hash.digest("hex") !== artifact.apkSha256) {
    throw new Error("远端 APK 与本地签名产物不一致，不能发布更新清单");
  }
}
