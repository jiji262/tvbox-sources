const MAX_BYTES = 1024 * 1024;
const MAX_VARINT_BYTES = 10;

export function encode(fields) {
  const parts = [];
  for (const [id, value] of fields) {
    const numeric = typeof value === "number" || typeof value === "bigint";
    parts.push(varint(BigInt(id * 8 + (numeric ? 0 : 2))));
    if (numeric) parts.push(varint(BigInt(value)));
    else {
      const data = Buffer.isBuffer(value) ? value : Buffer.from(value);
      parts.push(varint(BigInt(data.length)), data);
    }
  }
  return Buffer.concat(parts);
}

function varint(value) {
  const data = [];
  do { data.push(Number(value & 127n) | (value > 127n ? 128 : 0)); value >>= 7n; } while (value);
  return Buffer.from(data);
}

export function decode(data) {
  if (data.length > MAX_BYTES) throw new Error("protobuf_too_large");
  const cursor = { offset: 0 };
  const fields = new Map();
  while (cursor.offset < data.length) {
    const tag = readVarint(data, cursor);
    const field = Number(tag >> 3n), wire = Number(tag & 7n);
    if (!field || field > 0x1fffffff) throw new Error("protobuf_invalid_field");
    let value;
    if (wire === 0) value = readVarint(data, cursor);
    else {
      const size = wire === 2 ? Number(readVarint(data, cursor)) : ({ 1: 8, 5: 4 })[wire];
      if (!Number.isSafeInteger(size) || size < 0 || size > data.length - cursor.offset) {
        throw new Error("protobuf_truncated");
      }
      value = data.subarray(cursor.offset, cursor.offset + size); cursor.offset += size;
    }
    if (!fields.has(field)) fields.set(field, []);
    fields.get(field).push(value);
  }
  return fields;
}

function readVarint(data, cursor) {
  let value = 0n;
  for (let i = 0; i < MAX_VARINT_BYTES; i++) {
    if (cursor.offset >= data.length) throw new Error("protobuf_truncated");
    const byte = data[cursor.offset++];
    if (i === MAX_VARINT_BYTES - 1 && byte > 1) throw new Error("protobuf_overflow");
    value |= BigInt(byte & 127) << BigInt(i * 7);
    if (!(byte & 128)) return value;
  }
  throw new Error("protobuf_overflow");
}

export const bytes = (fields, id) => Buffer.isBuffer(fields.get(id)?.[0]) ? fields.get(id)[0] : Buffer.alloc(0);
export const text = (fields, id) => bytes(fields, id).toString("utf8");
export const number = (fields, id) => Number(fields.get(id)?.[0] ?? 0);
export const messages = (fields, id) => (fields.get(id) ?? []).filter(Buffer.isBuffer).map(decode);
