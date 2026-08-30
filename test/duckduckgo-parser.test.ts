import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeDuckDuckGoUrl,
  parseDuckDuckGoHtml,
} from "../src/search/duckduckgo-parser.js";

function result(title: string, href: string, snippet = "Snippet"): string {
  return `<div class="links_main"><h2 class="result__title"><a href="${href}">${title}</a></h2><div class="result__snippet">${snippet}</div></div>`;
}

function page(results: string, shell = ""): string {
  return `<html><body><form class="header__form" action="/html/" method="post"><input name="q" value="query"></form><div id="links">${shell}${results}</div></body></html>`;
}

describe("DuckDuckGo HTML parser", () => {
  it("extracts a direct result and nested text", () => {
    const parsed = parseDuckDuckGoHtml(
      page(
        result(
          "Docs &amp; Guide",
          "https://example.com/docs",
          "A <b>useful</b> reference",
        ),
      ),
    );
    assert.deepEqual(parsed, {
      kind: "results",
      results: [
        {
          title: "Docs & Guide",
          url: "https://example.com/docs",
          snippet: "A useful reference",
        },
      ],
    });
  });

  it("preserves order, normalizes Unicode whitespace, and allows no snippet", () => {
    const parsed = parseDuckDuckGoHtml(
      page(
        `${result("  First\n\t result  ", "https://example.com/1", " one\u00a0 two ")}<div class="links_main"><h2 class="result__title"><a href="https://example.com/2">Second</a></h2></div>`,
      ),
    );
    assert.equal(parsed.kind, "results");
    if (parsed.kind === "results") {
      assert.deepEqual(parsed.results, [
        {
          title: "First result",
          url: "https://example.com/1",
          snippet: "one two",
        },
        { title: "Second", url: "https://example.com/2", snippet: "" },
      ]);
    }
  });

  it("normalizes direct, relative, and protocol-relative redirects", () => {
    assert.equal(
      normalizeDuckDuckGoUrl("http://example.com/a?x=1#part"),
      "http://example.com/a?x=1#part",
    );
    assert.equal(
      normalizeDuckDuckGoUrl("https://example.com/a?x=1#part"),
      "https://example.com/a?x=1#part",
    );
    assert.equal(
      normalizeDuckDuckGoUrl(
        "/l?uddg=https%3A%2F%2Fexample.com%2Fa%3Fx%3D1%26y%3D2%23part",
      ),
      "https://example.com/a?x=1&y=2#part",
    );
    assert.equal(
      normalizeDuckDuckGoUrl(
        "//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Frelative",
      ),
      "https://example.com/relative",
    );
    assert.equal(
      normalizeDuckDuckGoUrl(
        "/l?q=https%3A%2F%2Fexample.com%2Fold%26x%3D1&sa=U",
      ),
      "https://example.com/old&x=1",
    );
  });

  it("rejects unsupported, credentialed, and internal destinations", () => {
    for (const href of [
      "javascript:alert(1)",
      "data:text/html,nope",
      "https://user:pass@example.com/",
      "https://duckduckgo.com/?q=internal",
      "https://duckduckgo.com/?uddg=https%3A%2F%2Fexample.com",
      "/html/?q=https%3A%2F%2Fexample.com&sa=U",
      "/l/?sa=U&q=https%3A%2F%2Fexample.com",
      "https://duckduckgo.com/l/?q=internal&sa=U",
      "https://duckduckgo.com./?q=internal",
    ]) {
      assert.equal(normalizeDuckDuckGoUrl(href), undefined, href);
    }
  });

  it("rejects missing title and malformed destinations", () => {
    assert.equal(
      parseDuckDuckGoHtml(page(result("   ", "https://example.com"))).kind,
      "invalid",
    );
    assert.equal(
      parseDuckDuckGoHtml(page(result("Title", "javascript:alert(1)"))).kind,
      "invalid",
    );
    assert.equal(
      parseDuckDuckGoHtml(
        '<div class="links_main"><div class="result__snippet">Incomplete</div></div>',
      ).kind,
      "invalid",
    );
  });

  it("requires both search form and results-shell markers for emptiness", () => {
    assert.deepEqual(parseDuckDuckGoHtml(page("")), { kind: "no_results" });
    for (const incomplete of [
      '<html><body><div id="links"></div></body></html>',
      '<html><body><form class="header__form" action="/html/"><input name="q"></form></body></html>',
      '<html><body><div class="serp__results"></div></body></html>',
      "<html><body><h1>Hello</h1></body></html>",
    ]) {
      assert.equal(parseDuckDuckGoHtml(incomplete).kind, "invalid", incomplete);
    }
  });

  it("classifies dedicated challenges while ignoring result text", () => {
    assert.deepEqual(
      parseDuckDuckGoHtml(
        '<html><body><form action="/html/"><input name="q"></form><div id="anomaly-modal">Please verify you are human</div></body></html>',
      ),
      { kind: "blocked" },
    );
    const ordinary = parseDuckDuckGoHtml(
      page(
        result("CAPTCHA research", "https://example.com", "A block page study"),
      ),
    );
    assert.equal(ordinary.kind, "results");
  });

  it("limits results to the first source-ordered items", () => {
    const parsed = parseDuckDuckGoHtml(
      page(
        `${result("First", "https://example.com/1")}${result("Second", "https://example.com/2")}${result("Third", "https://example.com/3")}`,
      ),
      2,
    );
    assert.equal(parsed.kind, "results");
    if (parsed.kind === "results") {
      assert.deepEqual(
        parsed.results.map((item) => item.title),
        ["First", "Second"],
      );
    }
  });
});
