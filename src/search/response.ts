import { byteLength } from "../bounds.js";
import { operationalError, type OperationalError } from "../contracts.js";

export interface BoundedResponseText {
  text?: string;
  error?: OperationalError;
}

function oversizedError(message: string): OperationalError {
  return operationalError("parse_failed", message, false);
}

async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal?: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (!signal) return await reader.read();
  if (signal.aborted) throw signal.reason ?? new Error("Response read aborted");

  return await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => {
      void reader.cancel(signal.reason).catch(() => undefined);
      finish(() => reject(signal.reason ?? new Error("Response read aborted")));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    reader.read().then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

export async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  oversizedMessage = `Search response exceeded ${maxBytes} bytes`,
): Promise<BoundedResponseText> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    return { error: oversizedError(oversizedMessage) };
  }

  if (!response.body) {
    const text = await response.text();
    return byteLength(text) > maxBytes
      ? { error: oversizedError(oversizedMessage) }
      : { text };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (true) {
      const item = await readChunk(reader, signal);
      if (item.done) break;
      received += item.value.byteLength;
      if (received > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { error: oversizedError(oversizedMessage) };
      }
      chunks.push(item.value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(bytes) };
}
