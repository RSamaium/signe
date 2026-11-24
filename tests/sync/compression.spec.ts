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

import {
  createMessageCompressor,
  createMessageDecoder,
  MESSAGE_FORMAT_DEFLATE_STREAM,
  MESSAGE_FORMAT_DEFLATE_STREAM_START,
} from "../../packages/sync/src";
import { vi } from "vitest";

/** Game-like packets: the same entities (random ids) with positions that change a little. */
const gamePackets = (count: number) => {
  let seed = 7;
  const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  const ids = Array.from({ length: 25 }, () => Array.from({ length: 8 }, () => Math.floor(random() * 36).toString(36)).join(""));
  const positions = ids.map(() => ({ x: Math.floor(random() * 500), y: Math.floor(random() * 500) }));
  return Array.from({ length: count }, (_, frame) => {
    for (const p of positions) {
      if (random() < 0.5) p.x += 3; else p.y += 3;
    }
    return JSON.stringify({
      type: "sync",
      value: {
        players: Object.fromEntries(
          ids.map((id, i) => [id, { x: positions[i].x, _frames: [{ ...positions[i], ts: 1795378073000 + frame * 50 + i }] }])
        ),
      },
    });
  });
};

describe("stream compression", () => {
  it("round-trips the messages of a connection, in order", () => {
    const compressor = createMessageCompressor();
    const decoder = createMessageDecoder();
    const packets = gamePackets(30);
    const frames = packets.map((json) => compressor.compress(json));
    expect(frames[0][0]).toBe(MESSAGE_FORMAT_DEFLATE_STREAM_START);
    expect(frames.slice(1).every((f) => f[0] === MESSAGE_FORMAT_DEFLATE_STREAM)).toBe(true);
    frames.forEach((frame, i) => expect(decoder.decode(frame)).toEqual(JSON.parse(packets[i])));
    compressor.close();
  });

  it("is smaller than compressing each message alone", () => {
    const compressor = createMessageCompressor();
    const packets = gamePackets(30);
    let stream = 0;
    let alone = 0;
    for (const json of packets) {
      stream += compressor.compress(json).length;
      alone += compressMessage(json).length;
    }
    expect(stream).toBeLessThan(alone * 0.75);
  });

  it("reads text, one-shot and stream frames mixed on the same connection", () => {
    const compressor = createMessageCompressor();
    const decoder = createMessageDecoder();
    const [a, b, c] = gamePackets(3);
    expect(decoder.decode(compressor.compress(a))).toEqual(JSON.parse(a));
    expect(decoder.decode(compressMessage(b))).toEqual(JSON.parse(b));
    expect(decoder.decode(b)).toEqual(JSON.parse(b));
    expect(decoder.decode(Buffer.from(compressor.compress(c)))).toEqual(JSON.parse(c));
  });

  it("handles messages larger than the output buffer", () => {
    const compressor = createMessageCompressor({ level: 1 });
    const decoder = createMessageDecoder();
    // Random-ish content compresses badly: the output exceeds 64 KB
    let seed = 1;
    const noise = Array.from({ length: 120_000 }, () => ((seed = (seed * 48271) % 2147483647) % 36).toString(36)).join("");
    const json = JSON.stringify({ type: "sync", value: { noise } });
    const frame = compressor.compress(json);
    expect(frame.length).toBeGreaterThan(64 * 1024);
    expect(decoder.decode(frame)).toEqual(JSON.parse(json));
  });

  it("starts over when a new stream starts (new connection)", () => {
    const decoder = createMessageDecoder();
    const [a, b, c] = gamePackets(3);
    const first = createMessageCompressor();
    decoder.decode(first.compress(a));
    decoder.decode(first.compress(b));
    const second = createMessageCompressor();
    expect(decoder.decode(second.compress(c))).toEqual(JSON.parse(c));
    expect(decoder.decode(second.compress(a))).toEqual(JSON.parse(a));
  });

  it("rejects stream frames outside of a stream", () => {
    const compressor = createMessageCompressor();
    const [a, b] = gamePackets(2);
    const start = compressor.compress(a);
    const next = compressor.compress(b);
    expect(() => decodeMessage(start)).toThrow(/createMessageDecoder/);
    const decoder = createMessageDecoder();
    expect(() => decoder.decode(next)).toThrow(/before the start/);
    decoder.decode(start);
    decoder.reset();
    expect(() => decoder.decode(next)).toThrow(/before the start/);
  });

  it("throws on corrupted stream data", () => {
    const decoder = createMessageDecoder();
    expect(() => decoder.decode(new Uint8Array([MESSAGE_FORMAT_DEFLATE_STREAM_START, 0xff, 0xff, 0xff, 0x00]))).toThrow();
  });
});

describe("stream compression without native zlib (browsers)", () => {
  it("fflate reads native streams; without native zlib, messages are compressed alone", async () => {
    const native = { compressor: createMessageCompressor(), decoder: createMessageDecoder() };
    vi.resetModules();
    const getBuiltinModule = (process as any).getBuiltinModule;
    (process as any).getBuiltinModule = undefined;
    let fallback: typeof import("../../packages/sync/src/compression");
    try {
      fallback = await import("../../packages/sync/src/compression");
    } finally {
      (process as any).getBuiltinModule = getBuiltinModule;
    }
    const pure = { compressor: fallback.createMessageCompressor(), decoder: fallback.createMessageDecoder() };
    for (const json of gamePackets(200)) {
      // A browser (fflate) reads the stream of a Node.js server
      expect(pure.decoder.decode(native.compressor.compress(json))).toEqual(JSON.parse(json));
      // A server without native streams compresses each message alone
      const frame = pure.compressor.compress(json);
      expect(frame[0]).toBe(MESSAGE_FORMAT_DEFLATE_JSON);
      expect(native.decoder.decode(frame)).toEqual(JSON.parse(json));
    }
  });
});
