import { createDecipheriv } from "node:crypto";
import { request, MEDIA_BYTES, ProbeError } from "./http.mjs";

const MAX_PLAYLIST_DEPTH = 3;
const TS_PACKET_BYTES = 188;

export async function probeMedia(url, options = {}) {
  const read = options.request ?? request;
  const settings = { headers: { ...options.headers, Range: "bytes=0-" + (MEDIA_BYTES - 1) },
    limit: MEDIA_BYTES, signal: options.signal };
  for (let depth = 0; depth < MAX_PLAYLIST_DEPTH; depth++) {
    const response = await readMedia(url, { read, settings });
    const text = response.bytes.toString("utf8").replace(/^\uFEFF/, "").trimStart();
    if (!text.startsWith("#EXTM3U")) {
      if (!isVideo(response.bytes)) throw new ProbeError("media", "invalid_video_data");
      return;
    }
    const lines = text.split(/\r?\n/).map((line) => line.trim());
    const index = lines.findIndex((line) => line && !line.startsWith("#"));
    if (index < 0) throw new ProbeError("media", "empty_playlist");
    const next = new URL(lines[index], response.url ?? url).toString();
    if (lines.some((line) => line.startsWith("#EXTINF:"))) {
      let bytes = (await readMedia(next, { read, settings })).bytes;
      bytes = await decryptSegment({ bytes, lines: lines.slice(0, index), url: response.url ?? url },
        { read, settings });
      if (!isVideo(bytes)) throw new ProbeError("media", "invalid_segment_data");
      return;
    }
    url = next;
  }
  throw new ProbeError("media", "playlist_too_deep");
}

async function readMedia(url, { read, settings }) {
  rejectPlaceholder(url);
  const response = await read(url, settings);
  rejectPlaceholder(response.url ?? url);
  return response;
}

function rejectPlaceholder(url) {
  const candidate = new URL(url);
  if (candidate.hostname === "yun2.jiexicn.top" && candidate.pathname === "/api/zhuanma/index.m3u8") {
    throw new ProbeError("media", "transcoding_placeholder");
  }
}

function isVideo(bytes) {
  if (bytes.length >= 12 && ["ftyp", "styp", "moof"].includes(bytes.toString("ascii", 4, 8))) return true;
  for (let i = 0; i + TS_PACKET_BYTES * 2 < bytes.length; i++) {
    if ([0, 1, 2].every((n) => bytes[i + n * TS_PACKET_BYTES] === 0x47)) return true;
  }
  return false;
}

async function decryptSegment({ bytes, lines, url }, { read, settings }) {
  const keyLine = lines.findLast((line) => line.startsWith("#EXT-X-KEY:")) ?? "";
  if (!keyLine.includes("METHOD=AES-128")) return bytes;
  const keyPath = /URI="([^"]+)"/.exec(keyLine)?.[1];
  if (!keyPath) throw new ProbeError("media", "missing_hls_key");
  const key = (await read(new URL(keyPath, url).toString(), { ...settings, limit: 32 })).bytes;
  if (key.length !== 16) throw new ProbeError("media", "invalid_hls_key");
  const sequence = lines.find((line) => line.startsWith("#EXT-X-MEDIA-SEQUENCE:"))?.split(":")[1] ?? "0";
  const hex = /IV=0x([a-fA-F0-9]+)/.exec(keyLine)?.[1] ?? BigInt(sequence).toString(16);
  const iv = Buffer.from(hex.padStart(32, "0"), "hex");
  const decipher = createDecipheriv("aes-128-cbc", key, iv).setAutoPadding(false);
  return decipher.update(bytes.subarray(0, bytes.length - bytes.length % 16));
}
