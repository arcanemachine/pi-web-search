import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { fetchDocument } from "../src/documents/fetch.js";
import {
  createDocumentFixture,
  type DocumentFixture,
} from "./document-fixture.js";

describe("bounded document fetch", () => {
  let fixture: DocumentFixture;
  before(async () => {
    fixture = await createDocumentFixture();
  });
  after(async () => {
    await fixture.close();
  });

  it("follows bounded HTTP redirects and records source metadata", async () => {
    const result = await fetchDocument(
      `${fixture.baseUrl}/redirect`,
      1_000,
      100_000,
    );
    assert.equal(result.error, undefined);
    assert.equal(result.value?.requestedUrl, `${fixture.baseUrl}/redirect`);
    assert.equal(result.value?.finalUrl, `${fixture.baseUrl}/technical`);
    assert.equal(result.value?.statusCode, 200);
    assert.equal(result.value?.etag, '"fixture-v1"');
    assert.ok((result.value?.downloadedBytes ?? 0) > 0);
  });

  it("rejects declared and streamed oversized bodies before unbounded buffering", async () => {
    for (const path of ["/oversize", "/chunked-oversize"]) {
      const result = await fetchDocument(
        `${fixture.baseUrl}${path}`,
        1_000,
        100,
      );
      assert.equal(result.error?.code, "fetch_failed");
      assert.match(result.error?.message ?? "", /100-byte download limit/);
    }
  });

  it("enforces the redirect limit", async () => {
    const result = await fetchDocument(
      `${fixture.baseUrl}/redirect-loop`,
      1_000,
      1_000,
    );
    assert.equal(result.error?.code, "fetch_failed");
    assert.match(result.error?.message ?? "", /5-redirect limit/);
  });

  it("returns structured timeouts and promptly forwards cancellation", async () => {
    const timeout = await fetchDocument(`${fixture.baseUrl}/slow`, 10, 1_000);
    assert.equal(timeout.error?.code, "timeout");

    const controller = new AbortController();
    const execution = fetchDocument(
      `${fixture.baseUrl}/slow`,
      1_000,
      1_000,
      controller.signal,
    );
    controller.abort(new Error("cancelled by fixture test"));
    await assert.rejects(execution, /cancelled by fixture test/);
  });

  it("returns structured HTTP and URL errors", async () => {
    const missing = await fetchDocument(
      `${fixture.baseUrl}/missing`,
      1_000,
      1_000,
    );
    assert.equal(missing.error?.code, "fetch_failed");
    assert.equal(missing.error?.retryable, false);

    const unsupported = await fetchDocument("file:///tmp/a", 1_000, 1_000);
    assert.equal(unsupported.error?.code, "invalid_request");
  });
});
