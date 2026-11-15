import { request, ProbeError } from "./http.mjs";
import { probeMedia } from "./media.mjs";

const MAX_SAMPLES = 2;
const MAX_EPISODES = 2;

export async function probeMacCms(line, options = {}) {
  let failure;
  for (const url of line.baseUrls) {
    try { await probeEndpoint(url, line, options); return { healthyUrls: [url] }; }
    catch (error) { failure = error; }
  }
  throw failure ?? new ProbeError("catalog", "no_endpoint");
}

async function probeEndpoint(baseUrl, line, options) {
  const read = options.request ?? request;
  const query = async (params, stage) => {
    const url = new URL(baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    const response = await read(url.toString(), { signal: options.signal });
    const body = JSON.parse(response.bytes.toString("utf8").replace(/^\uFEFF/, ""));
    if (!Array.isArray(body.list) || !body.list.length) throw new ProbeError(stage, "empty_result");
    return body.list;
  };
  const listing = await query({ ac: "videolist", pg: "1" }, "catalog");
  let failure = new ProbeError("catalog", "no_sample");
  for (const movie of listing.slice(0, MAX_SAMPLES)) {
    try {
      if (movie.vod_id == null || !movie.vod_name) throw new ProbeError("catalog", "invalid_sample");
      if (line.searchable !== false) await query({ ac: "videolist", wd: movie.vod_name }, "search");
      const details = await query({ ac: "videolist", ids: String(movie.vod_id) }, "details");
      await probeEpisodes(details[0], { ...options, request: read });
      return;
    } catch (error) { failure = error; }
  }
  throw failure;
}

async function probeEpisodes(movie, options) {
  const urls = String(movie.vod_play_url ?? "").split("$$$").flatMap((group) => group.split("#"))
    .map((episode) => episode.slice(episode.indexOf("$") + 1))
    .filter((url) => /^https?:\/\//i.test(url)).slice(0, MAX_EPISODES);
  let failure = new ProbeError("details", "no_playable_episode");
  for (const url of urls) {
    try { await probeMedia(url, options); return; }
    catch (error) { failure = error; }
  }
  throw failure;
}
