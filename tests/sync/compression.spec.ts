import { describe, expect, it } from "vitest";
import { compressMessage, decodeMessage, MESSAGE_FORMAT_DEFLATE_JSON } from "../../packages/sync/src";

describe("compressMessage / decodeMessage", () => {
  const packet = { type: "sync", value: { players: { p1: { x: 10, name: "héros 🗡️" } } } };
  const json = JSON.stringify(packet);

  it("round-trips a compressed message with a format byte", () => {
    const frame = compressMessage(json);
    expect(frame[0]).toBe(MESSAGE_FORMAT_DEFLATE_JSON);
    expect(decodeMessage(frame)).toEqual(packet);
  });

  it("decodes text frames as JSON, as before", () => {
    expect(decodeMessage(json)).toEqual(packet);
  });

  it("decodes frames received as ArrayBuffer or Node Buffer", () => {
    const frame = compressMessage(json, 6);
    const arrayBuffer = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    expect(decodeMessage(arrayBuffer)).toEqual(packet);
    expect(decodeMessage(Buffer.from(frame))).toEqual(packet);
  });

  it("makes large repetitive JSON smaller", () => {
    const big = JSON.stringify({ players: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`p${i}`, { x: i, y: i * 2, hp: 100 }])) });
    expect(compressMessage(big).length).toBeLessThan(big.length / 2);
  });

  it("rejects unknown binary formats and unsupported data", () => {
    expect(() => decodeMessage(new Uint8Array([42, 1, 2]))).toThrow(/Unknown message format/);
    expect(() => decodeMessage({})).toThrow(/Unsupported message data/);
  });
});

describe("native zlib and fflate interoperability", () => {
  it("frames compressed by one implementation are read by the other", async () => {
    const zlib = await import("node:zlib");
    const { deflateSync, inflateSync, strToU8, strFromU8 } = await import("../../packages/sync/node_modules/fflate");
    const json = JSON.stringify({ type: "sync", value: { a: "x".repeat(600) } });

    const nativeFrame = compressMessage(json);
    expect(strFromU8(inflateSync(nativeFrame.subarray(1)))).toBe(json);

    const fflateBody = deflateSync(strToU8(json), { level: 1 });
    const fflateFrame = new Uint8Array(fflateBody.length + 1);
    fflateFrame[0] = MESSAGE_FORMAT_DEFLATE_JSON;
    fflateFrame.set(fflateBody, 1);
    expect(decodeMessage(fflateFrame)).toEqual(JSON.parse(json));
    expect(zlib.inflateRawSync(fflateBody).toString()).toBe(json);
  });
});
