import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readBoundedResponseText } from "../src/search/response.js";

describe("bounded search response reader", () => {
  it("cancels a response stream as soon as it exceeds the byte limit", async () => {
    const encoder = new TextEncoder();
    let reads = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        reads += 1;
        controller.enqueue(encoder.encode(reads === 1 ? "1234" : "5678"));
      },
      cancel() {
        cancelled = true;
      },
    });

    const result = await readBoundedResponseText(new Response(stream), 7);

    assert.equal(result.error?.code, "parse_failed");
    assert.equal(result.text, undefined);
    assert.equal(cancelled, true);
    assert.ok(reads <= 3);
  });

  it("returns decoded text within the byte limit", async () => {
    const result = await readBoundedResponseText(
      new Response("bounded response"),
      100,
    );

    assert.equal(result.error, undefined);
    assert.equal(result.text, "bounded response");
  });
});
