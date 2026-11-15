import assert from "node:assert/strict";
import test from "node:test";
import { probeMedia } from "./media.mjs";
import { probeMacCms } from "./maccms.mjs";

const response = (value, url = "https://media.test/video") => ({
  bytes: Buffer.isBuffer(value) ? value : Buffer.from(value), status: 200, url,
});
const ts = Buffer.alloc(188 * 3);
for (let i = 0; i < 3; i++) ts[i * 188] = 0x47;

test("HTTP200 HTML不能被误判为视频", async () => {
  await assert.rejects(() => probeMedia("https://media.test/a", {
    request: async () => response("<html>blocked</html>"),
  }));
});

test("已确认的转码占位视频不能被判为可播放", async () => {
  await assert.rejects(() => probeMedia("https://yun2.jiexicn.top/api/zhuanma/index.m3u8", {
    request: async () => response(Buffer.from("0000ftypisom")),
  }));
});

test("重定向到已知转码占位时仍必须拒绝", async () => {
  await assert.rejects(() => probeMedia("https://media.test/redirect", {
    request: async () => response(Buffer.from("0000ftypisom"), "https://yun2.jiexicn.top/api/zhuanma/index.m3u8"),
  }), (error) => error.code === "transcoding_placeholder");
});

test("HLS检查读取实际分片，支持相对地址和主播放列表", async () => {
  const calls = [];
  await probeMedia("https://media.test/master.m3u8", { request: async (url) => {
    calls.push(url);
    if (url.endsWith("master.m3u8")) return response("#EXTM3U\nchild/list.m3u8", url);
    if (url.endsWith("list.m3u8")) return response("#EXTM3U\n#EXTINF:4,\nsegment.ts", url);
    return response(ts, url);
  } });
  assert.deepEqual(calls, ["https://media.test/master.m3u8",
    "https://media.test/child/list.m3u8", "https://media.test/child/segment.ts"]);
});

test("MP4检查真实文件头，拒绝空响应", async () => {
  await probeMedia("https://media.test/a.mp4", { request: async () => response(Buffer.from("0000ftypisom")) });
  await assert.rejects(() => probeMedia("https://media.test/a.mp4", { request: async () => response("") }));
});

test("采集接口验证搜索详情和视频，失败备用地址不能排在前面", async () => {
  const seen = [];
  const line = { id: "test", baseUrls: ["https://bad.test/", "https://good.test/"] };
  const result = await probeMacCms(line, { request: async (url) => {
    seen.push(url);
    if (url.startsWith("https://bad.test/")) throw new Error("HTTP 503");
    if (url.startsWith("https://media.test/")) return response(Buffer.from("0000ftypisom"), url);
    const params = new URL(url).searchParams;
    const movie = { vod_id: 42, vod_name: "测试影片", vod_play_url: "第一集$https://media.test/a.mp4" };
    return response(JSON.stringify({ code: 1, list: [movie] }), url);
  } });
  assert.deepEqual(result.healthyUrls, ["https://good.test/"]);
  assert.ok(seen.some((url) => new URL(url).searchParams.get("wd") === "测试影片"));
  assert.ok(seen.some((url) => new URL(url).searchParams.get("ids") === "42"));
});

test("目录正常但搜索或详情失败，不能判为可用", async () => {
  await assert.rejects(() => probeMacCms({ id: "test", baseUrls: ["https://api.test/"] }, {
    request: async (url) => response(JSON.stringify({
      code: 1, list: new URL(url).searchParams.has("wd") ? [] : [{ vod_id: 1, vod_name: "无搜索结果" }],
    }), url),
  }));
});

test("完整验证通过一个接口后立即保留结果，不让后续备用接口抹掉成功", async () => {
  const seen = [];
  const result = await probeMacCms({ baseUrls: ["https://good.test/", "https://slow.test/"] }, {
    request: async (url) => {
      seen.push(url);
      if (url.startsWith("https://slow.test/")) throw new Error("备用接口超时");
      if (url.startsWith("https://media.test/")) return response(Buffer.from("0000ftypisom"), url);
      return response(JSON.stringify({ list: [{ vod_id: 42, vod_name: "测试影片",
        vod_play_url: "第一集$https://media.test/a.mp4" }] }), url);
    },
  });
  assert.deepEqual(result.healthyUrls, ["https://good.test/"]);
  assert.ok(seen.every((url) => !url.startsWith("https://slow.test/")));
});
