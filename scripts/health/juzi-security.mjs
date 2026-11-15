import { constants, createCipheriv, createPublicKey, publicEncrypt, randomInt, randomUUID } from "node:crypto";
import { encode, decode, text } from "./proto.mjs";
import { ProbeError } from "./http.mjs";

export function createSecurity(config) {
  if (!config || Buffer.byteLength(config.sharedKey ?? "") !== 32 || Buffer.byteLength(config.bodyKey ?? "") !== 32
    || !Number.isInteger(config.fakePosition) || config.fakePosition < 1 || config.fakePosition > 4
    || !config.packageName || !/^\d+$/.test(config.versionCode ?? "") || !config.versionName) {
    throw new ProbeError("bootstrap", "invalid_jz_secret");
  }
  const primary = key(config.primaryPublicKey);
  const device = "tvbox-" + randomUUID();
  return {
    bootstrap() {
      const stamp = Date.now(), random = nonce(16);
      return encode([[1, stamp], [2, rsa(primary, stamp + random)],
        [3, nonce(16)], [4, random], [5, nonce(16)]]);
    },
    secondary(data) {
      const fields = decode(data);
      return key([1, 2, 3, 4, 5].filter((n) => n !== config.fakePosition).map((n) => text(fields, n)).join(""));
    },
    headers(secondary) {
      const params = { plat: "tv", vApp: config.versionCode, vName: config.versionName,
        pkg: config.packageName, chid: "tv", young: 0, udid: device, test_timestamp: Date.now() };
      if (secondary) Object.assign(params, signatures(config, secondary));
      return { Accept: "application/x-protobuf", "Content-Type": "application/x-protobuf",
        "Cache-Control": "no-cache", publicParams: JSON.stringify(params) };
    },
    body(params) {
      const stamp = Date.now(), random = nonce(8);
      const query = Object.entries(params).map(([name, value]) => name + "=" + value).join("&");
      const payload = random + aes(config.bodyKey, query + stamp);
      return encode([[1, payload.slice(0, 20)], [2, payload.slice(20)],
        [3, nonce(20)], [4, stamp], [5, random]]);
    },
  };
}

function signatures(config, secondary) {
  const timestamp = String(Date.now()), random = nonce(16);
  const encrypted = aes(config.sharedKey, timestamp + random);
  return { timestamp: Number(timestamp), random_str: random,
    sig: rsa(secondary, timestamp + random + config.versionCode),
    sig2: encrypted.slice(0, 8), sig3: encrypted.slice(8) };
}

function aes(secret, value) {
  const cipher = createCipheriv("aes-256-ecb", Buffer.from(secret), null);
  return Buffer.concat([cipher.update(value), cipher.final()]).toString("base64");
}
function rsa(publicKey, value) {
  return publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(value)).toString("base64");
}
function key(value) {
  try { return createPublicKey({ key: Buffer.from(value, "base64"), format: "der", type: "spki" }); }
  catch { throw new ProbeError("bootstrap", "invalid_jz_public_key"); }
}
function nonce(length) {
  const chars = [..."1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.slice(0, length - 1).join("") + "=";
}
