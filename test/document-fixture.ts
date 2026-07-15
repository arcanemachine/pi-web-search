import { createServer, type Server } from "node:http";

export interface DocumentFixture {
  baseUrl: string;
  requests(path: string): number;
  close(): Promise<void>;
}

export async function createDocumentFixture(): Promise<DocumentFixture> {
  const counts = new Map<string, number>();
  let changing = 0;
  const server: Server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://fixture.local");
    counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + 1);

    if (url.pathname === "/redirect") {
      response.writeHead(302, { Location: "/technical" });
      response.end();
      return;
    }
    if (url.pathname === "/technical") {
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        ETag: '"fixture-v1"',
      });
      response.end(`<!doctype html><html><head><title>Technical Docs</title>
        <style>.hidden{display:none}</style><script>throw new Error('not run')</script></head>
        <body><nav>Navigation noise</nav><main><h1>API Guide</h1>
        <p>Intro with a <a href="/reference">reference</a>.</p>
        <h2>Usage</h2><p>Target alpha.</p><p>Target beta.</p>
        <pre><code class="language-ts">const value = 1;</code></pre>
        <ul><li>First</li><li>Second</li></ul>
        <table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr></tbody></table>
        </main><footer>Footer noise</footer></body></html>`);
      return;
    }
    if (url.pathname === "/article") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        "<html><body><article><h1>Article</h1><p>Body</p></article></body></html>",
      );
      return;
    }
    if (url.pathname === "/malformed") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end("<main><h1>Broken<p>Still readable<ul><li>One<li>Two");
      return;
    }
    if (url.pathname === "/huge") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(`<main><p>${"界".repeat(20_000)}</p></main>`);
      return;
    }
    if (url.pathname === "/text") {
      response.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Plain\r\ntext\n\n\n\nend");
      return;
    }
    if (url.pathname === "/markdown") {
      response.writeHead(200, { "Content-Type": "text/markdown" });
      response.end("# Markdown\r\n\r\n- item");
      return;
    }
    if (url.pathname === "/json") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"name":"fixture","items":[1,2]}');
      return;
    }
    if (url.pathname === "/shell") {
      response.writeHead(200, { "Content-Type": "text/html" });
      response.end(
        '<html><body><div id="root">Loading</div><script src="app.js"></script></body></html>',
      );
      return;
    }
    if (url.pathname === "/changing") {
      changing += 1;
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.end(`Version ${changing}\n${"content ".repeat(40)}`);
      return;
    }
    if (url.pathname === "/oversize") {
      response.writeHead(200, {
        "Content-Type": "text/plain",
        "Content-Length": "10000",
      });
      response.end("x".repeat(10_000));
      return;
    }
    if (url.pathname === "/chunked-oversize") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      response.write("x".repeat(80));
      response.end("x".repeat(80));
      return;
    }
    if (url.pathname === "/redirect-loop") {
      response.writeHead(302, { Location: "/redirect-loop" });
      response.end();
      return;
    }
    if (url.pathname === "/slow") {
      setTimeout(() => {
        if (response.destroyed) return;
        response.writeHead(200, { "Content-Type": "text/plain" });
        response.end("slow");
      }, 200);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fixture server did not expose a TCP address");
  }
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests: (path) => counts.get(path) ?? 0,
    close: async () =>
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
