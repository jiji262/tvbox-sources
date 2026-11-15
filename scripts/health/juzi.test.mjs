import assert from "node:assert/strict";
import { generateKeyPairSync, createDecipheriv } from "node:crypto";
import test from "node:test";
import { createJuziProbe } from "./juzi.mjs";
import { encode, decode, bytes, number, text } from "./proto.mjs";

test("protobuf兼容当前协议并拒绝截断数据", () => {
  const value = encode([[1, 200], [3, encode([[9, "remote_4k"]])]]);
  const decoded = decode(value);
  assert.equal(number(decoded, 1), 200);
  assert.equal(text(decode(bytes(decoded, 3)), 9), "remote_4k");
  assert.throws(() => decode(Buffer.from([26, 5, 1])));
});

test("JZ共用一次握手和目录，逐个渠道使用真实标识解析媒体", async () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const key = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const config = { bootstrapUrls: ["https://fallback.test/config"], primaryPublicKey: key,
    sharedKey: "s".repeat(32), bodyKey: "b".repeat(32), fakePosition: 2,
    packageName: "test.package", versionCode: "3023", versionName: "3.0.2.3" };
  let handshakes = 0;
  let categories = 0;
  const channels = [];
  const client = createJuziProbe(config, { bootstrapUrls: ["https://remote.test/config"] }, {
    request: async (url, options = {}) => {
      let payload;
      if (url.endsWith("/config")) {
        return { bytes: Buffer.from('{"enabled":true,"domain":"https://native.test"}'), url };
      }
      if (url.endsWith("/zone")) {
        handshakes++;
        const chunks = key.match(new RegExp(".{1," + Math.ceil(key.length / 4) + "}", "g"));
        payload = encode([[1, chunks[0]], [2, "fake"], [3, chunks[1]], [4, chunks[2]], [5, chunks[3]]]);
      } else if (url.endsWith("/category") || url.endsWith("/search")) {
        if (url.endsWith("/category")) categories++;
        const query = decryptedQuery(options.body, config.bodyKey);
        payload = encode([[1, encode([[3, query.includes("typeId1=22") ? 43 : 42], [5, "测试影片"]])]]);
      } else if (url.endsWith("/getDetail")) {
        const id = decryptedQuery(options.body, config.bodyKey).startsWith("id=43") ? "other" : "remote_4k";
        payload = encode([[29, encode([[4, "episode"], [9, id]])]]);
      } else if (url.endsWith("/videoUsableUrl")) {
        const body = decode(options.body);
        const joined = text(body, 1) + text(body, 2);
        const aes = createDecipheriv("aes-256-ecb", Buffer.from(config.bodyKey), null);
        const query = Buffer.concat([aes.update(Buffer.from(joined.slice(8), "base64")), aes.final()]).toString();
        channels.push(/vodPlayFrom=([^&]+)/.exec(query)?.[1]);
        payload = encode([[1, "https://cdn.test/video.mp4"]]);
      } else return { bytes: Buffer.from("0000ftypisom"), url };
      return { bytes: encode([[1, 200], [3, payload]]), url };
    },
  });
  await client.prepare();
  await client.probe({ id: "juzi_remote_4k" });
  await client.probe({ id: "juzi_other" });
  assert.equal(handshakes, 1);
  assert.equal(categories, 5);
  assert.deepEqual(channels, ["remote_4k", "other"]);
});

test("JZ缺少协议配置或启动服务故障时停止整轮检测", async () => {
  assert.throws(() => createJuziProbe({}, {}));
});

test("已超时的JZ渠道立即停止，不再继续查询样本或解析", async () => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const config = { primaryPublicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    sharedKey: "s".repeat(32), bodyKey: "b".repeat(32), fakePosition: 2,
    packageName: "test.package", versionCode: "3023", versionName: "3.0.2.3" };
  const client = createJuziProbe(config, {});
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(() => client.probe({ id: "juzi_test" }, { signal: controller.signal }),
    (error) => error.name === "AbortError");
});

test("启动入口失败记录安全阶段和错误码，不输出协议或响应内容", async (context) => {
  const { publicKey } = generateKeyPairSync("rsa", { modulusLength: 1024 });
  const config = { primaryPublicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    sharedKey: "s".repeat(32), bodyKey: "b".repeat(32), fakePosition: 2,
    packageName: "test.package", versionCode: "3023", versionName: "3.0.2.3" };
  const diagnostics = [];
  context.mock.method(console, "warn", (line) => diagnostics.push(JSON.parse(line)));
  const client = createJuziProbe(config, { bootstrapUrls: ["https://remote.test/config"] }, {
    request: async (url) => {
      if (url.endsWith("/config")) return { bytes: Buffer.from('{"enabled":true,"domain":"https://native.test"}') };
      throw new Error("sensitive response or signed URL", { cause: { code: "ETIMEDOUT" } });
    },
  });
  await assert.rejects(() => client.prepare(), (error) => error.code === "jz_bootstrap_failed");
  assert.deepEqual(diagnostics, [{ stage: "handshake", bootstrapIndex: 0, code: "ETIMEDOUT" }]);
  assert.ok(!JSON.stringify(diagnostics).includes("sensitive"));
});

function decryptedQuery(value, secret) {
  const body = decode(value);
  const joined = text(body, 1) + text(body, 2);
  const aes = createDecipheriv("aes-256-ecb", Buffer.from(secret), null);
  return Buffer.concat([aes.update(Buffer.from(joined.slice(8), "base64")), aes.final()]).toString();
}
