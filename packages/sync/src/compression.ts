import { Inflate, deflateSync, inflateSync, strFromU8, strToU8 } from "fflate";

/**
 * Wire format of a compressed message: a binary frame whose first byte is the format,
 * followed by the payload. Text frames are plain JSON, as before.
 */
export const MESSAGE_FORMAT_DEFLATE_JSON = 1;
/**
 * Compressed message that continues the DEFLATE stream of the connection: it may refer to
 * the messages sent before it, so it can only be read by the connection's
 * {@link MessageDecoder}, in order. See {@link createMessageCompressor}.
 */
export const MESSAGE_FORMAT_DEFLATE_STREAM = 2;
/** Like {@link MESSAGE_FORMAT_DEFLATE_STREAM}, but first message of a new stream. */
export const MESSAGE_FORMAT_DEFLATE_STREAM_START = 3;

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
/** Query parameter a client sends when it can read stream messages (formats 2 and 3). */
export const COMPRESSION_STREAM_QUERY_PARAM = "compressionStream";
export const COMPRESSION_STREAM_QUERY_VALUE = "1";

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
  if (bytes[0] === MESSAGE_FORMAT_DEFLATE_STREAM || bytes[0] === MESSAGE_FORMAT_DEFLATE_STREAM_START) {
    throw new Error("Stream messages are read with the connection's decoder: use createMessageDecoder()");
  }
  throw new Error(`Unknown message format: ${bytes[0]}`);
}

/* ---------------------------------------------------------------------------------------------
 * Stream compression
 *
 * A one-shot compression (format 1) starts from nothing for each message: zlib allocates and
 * sets up a new context every time, and a message cannot refer to the previous ones. When a
 * server sends its own packet to each client (syncVisibility, interceptorPacket), it is cheaper
 * to keep one DEFLATE stream per connection, flushed after each message (Z_SYNC_FLUSH, like the
 * permessage-deflate WebSocket extension): no setup per message, and the positions of the last
 * packet are found again in the next one. On RPG-JS packets (2 KB), this is 3 times faster
 * and 2 times smaller than one-shot compression.
 * ------------------------------------------------------------------------------------------- */

const Z_SYNC_FLUSH = 2;
const NodeBuffer: any = (globalThis as any).Buffer;

/** Output buffer shared by every native stream (calls are synchronous). */
let nativeOutput: Uint8Array | null = null;

/**
 * Runs a native zlib stream on `input` until all of it is consumed and flushed, through the
 * synchronous handle Node.js uses for `deflateRawSync` (the public API has no synchronous
 * streaming). Its availability is checked once by {@link nativeStreamsWork}.
 *
 * @param prefix - Format byte to write before the output, or -1 for none.
 * @returns A copy of the output.
 */
function runNativeStream(stream: any, input: Uint8Array, prefix: number): Uint8Array {
  const handle = stream._handle;
  if (!handle || stream.signeError) {
    throw new Error(`Compression stream unusable after an error: ${stream.signeError ?? "closed"}`);
  }
  const state: Uint32Array = stream._writeState;
  let output = (nativeOutput ??= new Uint8Array(64 * 1024));
  let outOffset = prefix >= 0 ? 1 : 0;
  let inOffset = 0;
  let inLength = input.length;
  for (;;) {
    const outAvailable = output.length - outOffset;
    handle.writeSync(Z_SYNC_FLUSH, input, inOffset, inLength, output, outOffset, outAvailable);
    if (stream.signeError) {
      throw new Error(`Invalid compressed message: ${stream.signeError}`);
    }
    const outLeft = state[0];
    const inLeft = state[1];
    outOffset += outAvailable - outLeft;
    inOffset += inLength - inLeft;
    inLength = inLeft;
    if (outLeft !== 0) break;
    // Output buffer full: grow it and go on
    const bigger = new Uint8Array(output.length * 2);
    bigger.set(output.subarray(0, outOffset));
    output = nativeOutput = bigger;
  }
  if (prefix >= 0) output[0] = prefix;
  return output.slice(0, outOffset);
}

/**
 * Creates a native zlib stream used synchronously. An error (corrupted data) is kept on the
 * stream and thrown by {@link runNativeStream}, instead of the asynchronous `error` event of
 * Node.js streams, which nobody listens to here.
 */
function createNativeStream(create: "createDeflateRaw" | "createInflateRaw", options?: any): any {
  const stream = nativeZlib[create](options);
  stream._handle.onerror = (message: string) => {
    stream.signeError = message || "zlib error";
  };
  return stream;
}

let nativeStreamsChecked: boolean | undefined;

/** Whether native synchronous streams work in this runtime (checked once, with a round trip). */
function nativeStreamsWork(): boolean {
  if (nativeStreamsChecked !== undefined) return nativeStreamsChecked;
  nativeStreamsChecked = false;
  if (!nativeZlib || !NodeBuffer) return false;
  try {
    const probe = nativeZlib.createDeflateRaw({ level: 1 });
    const usable = typeof probe._handle?.writeSync === "function" && probe._writeState instanceof Uint32Array;
    probe.close();
    if (!usable) return false;
    const deflate = createNativeStream("createDeflateRaw", { level: 1 });
    const inflate = createNativeStream("createInflateRaw");
    if (typeof deflate._handle?.writeSync !== "function" || !(deflate._writeState instanceof Uint32Array)) {
      return false;
    }
    const messages = ['{"type":"sync","value":{"x":1}}', '{"type":"sync","value":{"x":2}}'];
    for (const message of messages) {
      const compressed = runNativeStream(deflate, NodeBuffer.from(message), -1);
      const restored = NodeBuffer.from(runNativeStream(inflate, compressed, -1)).toString();
      if (restored !== message) return false;
    }
    deflate.close();
    inflate.close();
    nativeStreamsChecked = true;
  } catch {
    nativeStreamsChecked = false;
  }
  return nativeStreamsChecked;
}

function concatChunks(chunks: Uint8Array[], prefix: number): Uint8Array {
  let length = prefix >= 0 ? 1 : 0;
  for (const chunk of chunks) length += chunk.length;
  const out = new Uint8Array(length);
  let offset = 0;
  if (prefix >= 0) out[offset++] = prefix;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export interface MessageCompressorOptions {
  /** DEFLATE level, 1 (fastest, recommended) to 9. Default: 1. */
  level?: number;
  /**
   * Size of the history a message can refer to: 2^windowBits bytes (9 to 15). Default: 13
   * (8 KB), which keeps the gain of the 32 KB window on small packets.
   */
  windowBits?: number;
  /** Memory of the match finder (1 to 9). Default: 5. */
  memLevel?: number;
}

/** Compresses the messages of one connection as one stream. */
export interface MessageCompressor {
  /**
   * Compresses the next message of the connection.
   * @returns A binary frame (format 2, or 3 for the first message).
   */
  compress(json: string): Uint8Array;
  /** Frees the stream. */
  close(): void;
}

/**
 * Creates the compressor of one connection. Messages must be sent in the order they were
 * compressed, and read with one {@link createMessageDecoder} per connection.
 *
 * Uses native zlib (Node.js): about 48 KB of memory per connection with the default options.
 * In runtimes without it, each message is compressed alone ({@link compressMessage}).
 *
 * @example
 * const compressor = createMessageCompressor();
 * conn.send(compressor.compress(JSON.stringify(packet)));
 * // when the connection closes
 * compressor.close();
 */
export function createMessageCompressor(options: MessageCompressorOptions = {}): MessageCompressor {
  const level = options.level ?? 1;
  let started = false;
  const nextPrefix = () => {
    if (started) return MESSAGE_FORMAT_DEFLATE_STREAM;
    started = true;
    return MESSAGE_FORMAT_DEFLATE_STREAM_START;
  };
  if (nativeStreamsWork()) {
    const stream = createNativeStream("createDeflateRaw", {
      level,
      windowBits: options.windowBits ?? 13,
      memLevel: options.memLevel ?? 5,
    });
    return {
      compress: (json) => runNativeStream(stream, NodeBuffer.from(json), nextPrefix()),
      close: () => stream.close(),
    };
  }
  // No synchronous native stream in this runtime (fflate's Deflate.flush() may keep the last
  // bytes of a message): each message is compressed alone, which every decoder reads.
  return {
    compress: (json) => compressMessage(json, level),
    close() {},
  };
}

/** Reads the messages of one connection, including stream messages. */
export interface MessageDecoder {
  /** Same as {@link decodeMessage}, and also reads stream messages (formats 2 and 3). */
  decode(data: any): any;
  /** Forgets the stream (call it when the connection is opened again). */
  reset(): void;
}

/**
 * Creates the decoder of one connection. Every message of the connection must go through it,
 * in the order received: a stream message refers to the ones before it.
 *
 * @example
 * const decoder = createMessageDecoder();
 * socket.addEventListener("open", () => decoder.reset());
 * socket.addEventListener("message", (event) => {
 *   const packet = decoder.decode(event.data);
 * });
 */
export function createMessageDecoder(): MessageDecoder {
  let inflate: ((bytes: Uint8Array) => Uint8Array) | null = null;
  let close: (() => void) | null = null;

  const reset = () => {
    close?.();
    inflate = null;
    close = null;
  };
  const start = () => {
    reset();
    if (nativeStreamsWork()) {
      const stream = createNativeStream("createInflateRaw");
      inflate = (bytes) => runNativeStream(stream, bytes, -1);
      close = () => stream.close();
      return;
    }
    let chunks: Uint8Array[] = [];
    const inflater = new Inflate((chunk) => {
      chunks.push(chunk);
    });
    inflate = (bytes) => {
      chunks = [];
      inflater.push(bytes);
      return chunks.length === 1 ? chunks[0] : concatChunks(chunks, -1);
    };
  };

  return {
    decode(data: any) {
      if (typeof data === "string") return JSON.parse(data);
      const bytes = toBytes(data);
      const format = bytes?.[0];
      if (bytes && (format === MESSAGE_FORMAT_DEFLATE_STREAM || format === MESSAGE_FORMAT_DEFLATE_STREAM_START)) {
        if (format === MESSAGE_FORMAT_DEFLATE_STREAM_START) start();
        if (!inflate) {
          throw new Error("Stream message received before the start of the stream");
        }
        const inflated = inflate(bytes.subarray(1));
        return JSON.parse(textDecoder ? textDecoder.decode(inflated) : strFromU8(inflated));
      }
      return decodeMessage(data);
    },
    reset,
  };
}
