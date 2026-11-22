import { deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

/**
 * Wire format of a compressed message: a binary frame whose first byte is the format,
 * followed by the payload. Text frames are plain JSON, as before.
 */
export const MESSAGE_FORMAT_DEFLATE_JSON = 1;

/**
 * Native zlib when the runtime exposes it synchronously (Node.js >= 20.16 / 22.3), which is
 * 2.5 to 5 times faster than fflate. Otherwise (browsers, other runtimes) fflate is used.
 * Both produce and read the same raw DEFLATE format.
 */
const nativeZlib: any = (() => {
  try {
    return (globalThis as any).process?.getBuiltinModule?.("node:zlib") ?? null;
  } catch {
    return null;
  }
})();

const textDecoder = typeof TextDecoder !== "undefined" ? new TextDecoder() : null;

/** Query parameter a client sends to ask the server for compressed messages. */
export const COMPRESSION_QUERY_PARAM = "compression";
export const COMPRESSION_QUERY_VALUE = "deflate";

/**
 * Compresses an already serialized JSON message (raw DEFLATE).
 *
 * @param json - The JSON string to send.
 * @param level - DEFLATE level, 1 (fastest, recommended) to 9.
 * @returns A binary frame: format byte followed by the compressed UTF-8 JSON.
 *
 * @example
 * const frame = compressMessage(JSON.stringify({ type: "sync", value }), 1);
 * conn.send(frame);
 */
export function compressMessage(json: string, level: number = 1): Uint8Array {
  const compressed: Uint8Array = nativeZlib
    ? nativeZlib.deflateRawSync(json, { level })
    : deflateSync(strToU8(json), { level: level as any });
  const frame = new Uint8Array(compressed.length + 1);
  frame[0] = MESSAGE_FORMAT_DEFLATE_JSON;
  frame.set(compressed, 1);
  return frame;
}

function toBytes(data: any): Uint8Array | null {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

/**
 * Decodes a message received from the server: a JSON text frame, or a compressed
 * binary frame produced by {@link compressMessage}.
 *
 * Binary frames must be received as `ArrayBuffer` (set `socket.binaryType = "arraybuffer"`)
 * or as a Node.js `Buffer` / typed array.
 *
 * @throws If the message is not valid JSON or uses an unknown format.
 *
 * @example
 * socket.addEventListener("message", (event) => {
 *   const packet = decodeMessage(event.data);
 *   if (packet.type === "sync") load(state, packet.value, true);
 * });
 */
export function decodeMessage(data: any): any {
  if (typeof data === "string") {
    return JSON.parse(data);
  }
  const bytes = toBytes(data);
  if (!bytes) {
    throw new Error("Unsupported message data: expected a string, an ArrayBuffer or a typed array");
  }
  if (bytes[0] === MESSAGE_FORMAT_DEFLATE_JSON) {
    const payload = bytes.subarray(1);
    const inflated: Uint8Array = nativeZlib ? nativeZlib.inflateRawSync(payload) : inflateSync(payload);
    return JSON.parse(textDecoder ? textDecoder.decode(inflated) : strFromU8(inflated));
  }
  throw new Error(`Unknown message format: ${bytes[0]}`);
}
