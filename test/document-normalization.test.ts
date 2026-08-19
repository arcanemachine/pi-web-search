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
    assert.equal(value.extractor, "html:jsdom+node-html-markdown@2");
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

  it("keeps role and article roots deterministic", () => {
    for (const rootName of ['[role="main"]', "article"]) {
      const result = normalizeDocument(
        `<body><div>Noise</div><${rootName === "article" ? "article" : 'div role="main"'}>Important ${rootName}</${rootName === "article" ? "article" : "div"}></body>`,
        "text/html",
        "https://example.com",
        "main",
      );
      assert.equal(result.value?.extractor, "html:jsdom+node-html-markdown@2");
      assert.match(result.value?.content ?? "", /Important/);
      assert.doesNotMatch(result.value?.content ?? "", /Noise/);
    }
  });

  it("keeps full mode and explicit selectors deterministic", () => {
    const full = normalizeDocument(
      "<body><header>Header</header><main>Main</main><section>Section</section><nav>Nav</nav><footer>Footer</footer></body>",
      "text/html",
      "https://example.com",
      "full",
    );
    assert.equal(full.value?.extractor, "html:jsdom+node-html-markdown@2");
    assert.match(full.value?.content ?? "", /Header|Main|Section/);
    assert.doesNotMatch(full.value?.content ?? "", /Nav|Footer/);

    const selected = normalizeDocument(
      '<body><div id="chosen">Chosen content</div><div>Unrelated content</div></body>',
      "text/html",
      "https://example.com",
      "main",
      "#chosen",
    );
    assert.equal(selected.value?.extractor, "html:jsdom+node-html-markdown@2");
    assert.match(selected.value?.content ?? "", /Chosen content/);
    assert.doesNotMatch(selected.value?.content ?? "", /Unrelated/);
    assert.equal(
      normalizeDocument(
        "<body><div>content</div></body>",
        "text/html",
        "https://example.com",
        "main",
        ".missing",
      ).error?.code,
      "parse_failed",
    );
  });

  it("uses Readability for weakly structured article pages", () => {
    const result = normalizeDocument(
      `<body><div class="promotion">Buy this unrelated promotion</div>
       <div class="article"><h1>Primary article</h1>
       <p>First primary paragraph with important context.</p>
       <p>Second primary paragraph with additional detail.</p>
       <p>Third primary paragraph closes the article.</p></div>
       <div class="comments">Unrelated comments and recommendations</div></body>`,
      "text/html",
      "https://example.com/story",
      "main",
    );
    assert.equal(
      result.value?.extractor,
      "html:jsdom+readability+node-html-markdown@2",
    );
    assert.match(result.value?.content ?? "", /First primary paragraph/);
    assert.match(result.value?.content ?? "", /Third primary paragraph/);
    assert.doesNotMatch(
      result.value?.content ?? "",
      /Buy this unrelated promotion|Unrelated comments/,
    );
    assert.doesNotMatch(
      result.value?.warnings.map((warning) => warning.code).join(" ") ?? "",
      /main_content_fallback/,
    );
  });

  it("preserves nested sectioned body documents without Readability", () => {
    const result = normalizeDocument(
      `<body><section><h1>Technical Standard</h1><p>Intermediaries and Header Fields.</p>
       <section><h2>Date and Trailer</h2><p>Representation Metadata and Language Tags.</p></section></section></body>`,
      "text/html",
      "https://example.com/rfc",
      "main",
    );
    assert.equal(result.value?.extractor, "html:jsdom+node-html-markdown@2");
    assert.match(
      result.value?.content ?? "",
      /Intermediaries and Header Fields/,
    );
    assert.match(
      result.value?.content ?? "",
      /Representation Metadata and Language Tags/,
    );
    assert.equal(
      result.value?.warnings.some(
        (warning) => warning.code === "main_content_fallback",
      ),
      true,
    );
  });

  it("falls back to the cleaned body when Readability has no content", () => {
    const result = normalizeDocument(
      "<body><script>not content</script></body>",
      "text/html",
      "https://example.com/empty",
      "main",
    );
    assert.equal(result.value?.extractor, "html:jsdom+node-html-markdown@2");
    assert.equal(result.value?.content, "");
    assert.equal(
      result.value?.warnings.some(
        (warning) => warning.code === "main_content_fallback",
      ),
      true,
    );
  });

  it("resolves safe URLs and removes unsupported sources", () => {
    const result = normalizeDocument(
      `<main><a href="/docs">Docs</a><a href="mailto:test@example.com">Mail</a>
       <a href="javascript:alert(1)">Bad link</a><a href="#heading">Local</a>
       <img src="../image.png"><img src="data:image/png;base64,abc"><img src="file:///tmp/x"></main>`,
      "text/html",
      "https://example.com/path/page",
      "main",
    );
    const content = result.value?.content ?? "";
    assert.match(content, /https:\/\/example\.com\/docs/);
    assert.match(content, /mailto:test@example\.com/);
    assert.match(content, /https:\/\/example\.com\/image\.png/);
    assert.match(content, /Local/);
    assert.doesNotMatch(content, /javascript:|data:image|file:\/\//);
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
    assert.equal(
      result.value?.warnings.some(
        (warning) => warning.code === "client_rendered_shell",
      ),
      true,
    );
  });
});
