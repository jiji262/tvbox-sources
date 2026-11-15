import { request, safeUrl, ProbeError } from "./http.mjs";
import { createSecurity } from "./juzi-security.mjs";
import { decode, bytes, text, number, messages } from "./proto.mjs";
import { probeMedia } from "./media.mjs";

const MAX_SAMPLES = 3;
const MAX_EPISODES = 2;
const FORBIDDEN_HEADERS = new Set(["host", "range", "connection", "content-length", "transfer-encoding", "accept-encoding"]);

export function createJuziProbe(config, discovery, options = {}) {
  const security = createSecurity(config);
  const read = options.request ?? request;
  const urls = [...new Set([...(discovery?.bootstrapUrls ?? []), ...(config.bootstrapUrls ?? [])])];
  const cache = new Map();
  let samples;
  let session;
  async function prepare() {
    for (const url of urls) {
      try {
        if (safeUrl(url).protocol !== "https:") continue;
        const data = JSON.parse((await read(url)).bytes.toString());
        if (data.enabled !== true) continue;
        const domain = safeUrl(data.domain);
        domain.protocol = "https:"; domain.pathname = "/"; domain.search = ""; domain.hash = "";
        const response = await read(new URL("/api/v5/find/app/zone", domain).toString(),
          { body: security.bootstrap(), headers: security.headers() });
        session = { domain, key: security.secondary(unwrap(response.bytes)) };
        return;
      } catch { /* 不输出启动响应、协议配置或签名。 */ }
    }
    throw new ProbeError("bootstrap", "jz_bootstrap_failed");
  }
  async function load(endpoint, params, signal) {
    signal?.throwIfAborted();
    if (!session) throw new ProbeError("bootstrap", "jz_not_prepared");
    const response = await read(new URL(endpoint, session.domain).toString(), {
      body: security.body(params), headers: security.headers(session.key), signal,
    });
    return decode(unwrap(response.bytes));
  }
  const catalog = (endpoint, params) => {
    const id = endpoint + JSON.stringify(params);
    if (!cache.has(id)) cache.set(id, load(endpoint, params));
    return cache.get(id);
  };
  const getSamples = () => samples ??= sampleMovies(catalog);
  return { prepare, warmup: getSamples, probe: (line, probeOptions = {}) =>
    probeChannel(line, { catalog, load, read, getSamples, ...probeOptions }) };
}

function unwrap(data) {
  const response = decode(data);
  if (number(response, 1) !== 200) throw new ProbeError("catalog", "jz_response_error");
  return bytes(response, 3);
}

async function probeChannel(line, { catalog, load, read, signal, getSamples }) {
  signal?.throwIfAborted();
  const channel = /^juzi_([A-Za-z0-9_][A-Za-z0-9_.-]{0,58})$/.exec(line.id)?.[1];
  if (!channel) throw new ProbeError("catalog", "invalid_jz_channel");
  let failure = new ProbeError("details", "no_channel_sample");
  for (const movie of await getSamples()) {
    signal?.throwIfAborted();
    try {
      if (line.searchable !== false) {
        const search = await catalog("/api/proto/v5/drama/search",
          { page: "1", pagesize: "20", searchKeys: text(movie, 5) });
        if (!messages(search, 1).length) throw new ProbeError("search", "empty_search");
      }
      const detail = await catalog("/api/proto/v5/drama/getDetail", { id: String(number(movie, 3)) });
      signal?.throwIfAborted();
      const episodes = messages(detail, 29).filter((episode) => text(episode, 9) === channel && text(episode, 4));
      if (!episodes.length) continue;
      await probeEpisodes(episodes, { channel, load, read, signal });
      return {};
    } catch (error) { signal?.throwIfAborted(); failure = error; }
  }
  throw failure;
}

async function sampleMovies(catalog) {
  const samples = new Map();
  for (const typeId of [null, 20, 21, 22, 23]) {
    try {
      const params = { page: "1", pagesize: "20", ...(typeId ? { typeId1: String(typeId) } : {}) };
      const listing = await catalog("/api/proto/v5/drama/category", params);
      for (const movie of messages(listing, 1).slice(0, MAX_SAMPLES)) samples.set(number(movie, 3), movie);
    } catch { /* 其他分类仍可提供测试样本。 */ }
  }
  if (!samples.size) throw new ProbeError("catalog", "no_catalog_sample");
  return [...samples.values()];
}

async function probeEpisodes(episodes, { channel, load, read, signal }) {
  let failure = new ProbeError("media", "no_playable_episode");
  for (const episode of episodes.slice(0, MAX_EPISODES)) {
    signal?.throwIfAborted();
    try {
      const playUrl = new URLSearchParams({ x: text(episode, 4) }).toString().slice(2);
      const media = await load("/api/proto/v5/videoUsableUrl", { vodPlayFrom: channel, playUrl }, signal);
      const headers = Object.fromEntries(messages(media, 6)
        .map((entry) => [text(entry, 1), text(entry, 2)]).filter(([name]) => !FORBIDDEN_HEADERS.has(name.toLowerCase())));
      await probeMedia(text(media, 1), { headers, signal, request: read });
      return;
    } catch (error) { failure = error; }
  }
  throw failure;
}
