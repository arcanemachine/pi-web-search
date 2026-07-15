import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDocument } from "../src/documents/markdown.js";

describe("document normalization", () => {
  it("extracts deterministic main Markdown without executing or retaining non-content elements", () => {
    const result = normalizeDocument(
      `<!doctype html><html><head><title>Docs</title><script>globalThis.bad = true</script></head>
       <body><nav>Noise</nav><main><h1>Guide</h1><p>Read <a href="/docs">docs</a>.</p>
       <pre><code>const x = 1;</code></pre><ul><li>One</li><li>Two</li></ul>
       <table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table></main></body></html>`,
      "text/html",
      "https://example.com/base",
      "main",
    );
    assert.equal(result.error, undefined);
    const value = result.value;
    assert.ok(value);
    assert.equal(value.title, "Docs");
    assert.match(value.content, /^# Guide/m);
    assert.match(value.content, /https:\/\/example\.com\/docs/);
    assert.match(value.content, /```[\s\S]*const x = 1;[\s\S]*```/);
    assert.match(value.content, /- One/);
    assert.match(value.content, /\| A \| B \|/);
    assert.doesNotMatch(value.content, /Noise|globalThis\.bad/);
    assert.equal(value.extractor, "html:linkedom+node-html-markdown@1");
  });

  it("handles malformed HTML and explicit selectors", () => {
    const malformed = normalizeDocument(
      "<body><article><h1>Broken<p>Still readable<ul><li>One<li>Two",
      "text/html",
      "https://example.com",
      "main",
    );
    assert.match(malformed.value?.content ?? "", /Still readable/);

    const selected = normalizeDocument(
      '<body><section id="first">First</section><section id="chosen"><h2>Chosen</h2></section></body>',
      "text/html",
      "https://example.com",
      "full",
      "#chosen",
    );
    assert.match(selected.value?.content ?? "", /Chosen/);
    assert.doesNotMatch(selected.value?.content ?? "", /First/);
    assert.equal(
      normalizeDocument(
        "<body><main>x</main></body>",
        "text/html",
        "https://example.com",
        "main",
        "[",
      ).error?.code,
      "invalid_request",
    );
  });

  it("preserves supported native text, Markdown, and JSON", () => {
    const text = normalizeDocument(
      "Plain\r\ntext\n\n\n\nend",
      "text/plain",
      "https://example.com",
      "main",
    );
    assert.equal(text.value?.content, "Plain\ntext\n\n\nend");
    assert.equal(text.value?.extractor, "native:text@1");

    const markdown = normalizeDocument(
      "# Heading\r\n\r\n- item",
      "text/markdown",
      "https://example.com",
      "main",
    );
    assert.equal(markdown.value?.content, "# Heading\n\n- item");
    assert.equal(markdown.value?.extractor, "native:markdown@1");

    const json = normalizeDocument(
      '{"name":"fixture","value":1}',
      "application/json",
      "https://example.com",
      "main",
    );
    assert.equal(
      json.value?.content,
      '{\n  "name": "fixture",\n  "value": 1\n}',
    );
    assert.equal(json.value?.extractor, "native:json@1");
    assert.equal(
      normalizeDocument(
        "not json",
        "application/json",
        "https://example.com",
        "main",
      ).error?.code,
      "parse_failed",
    );
  });

  it("warns conservatively for likely client-rendered shells", () => {
    const result = normalizeDocument(
      '<body><div id="root">Loading</div><script src="app.js"></script></body>',
      "text/html",
      "https://example.com",
      "main",
    );
    assert.equal(result.value?.warnings[0]?.code, "main_content_fallback");
    assert.equal(
      result.value?.warnings.some(
        (warning) => warning.code === "client_rendered_shell",
      ),
      true,
    );
  });
});
