import { NodeHtmlMarkdown } from "node-html-markdown";
import { parseHTML } from "linkedom";
import { truncateChars } from "../bounds.js";
import {
  operationalError,
  type Diagnostic,
  type OperationalError,
} from "../contracts.js";
import type { DocumentMode, NormalizedDocument } from "./types.js";

const REMOVED_ELEMENTS = [
  "script",
  "style",
  "template",
  "noscript",
  "iframe",
  "canvas",
  "svg",
  "form",
  "button",
  "input",
  "select",
  "textarea",
  "nav",
  "footer",
  "aside",
].join(",");

export type NormalizeDocumentResult =
  | { value: NormalizedDocument; error?: never }
  | { value?: never; error: OperationalError };

function normalizeText(value: string): string {
  return value
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function mimeType(contentType: string): string {
  return contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function absolutizeLinks(root: Element, finalUrl: string): void {
  for (const element of Array.from(root.querySelectorAll("a[href],img[src]"))) {
    const attribute = element.tagName.toLowerCase() === "a" ? "href" : "src";
    const value = element.getAttribute(attribute)?.trim();
    if (!value || value.startsWith("#")) continue;
    if (value.startsWith("data:")) {
      element.removeAttribute(attribute);
      continue;
    }
    try {
      const resolved = new URL(value, finalUrl);
      const allowed =
        resolved.protocol === "http:" ||
        resolved.protocol === "https:" ||
        (attribute === "href" && resolved.protocol === "mailto:");
      if (allowed) element.setAttribute(attribute, resolved.toString());
      else element.removeAttribute(attribute);
    } catch {
      element.removeAttribute(attribute);
    }
  }
}

function htmlDocument(
  body: string,
  finalUrl: string,
  mode: DocumentMode,
  selector?: string,
): NormalizeDocumentResult {
  let document: Document;
  try {
    document = parseHTML(body).document;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: operationalError(
        "parse_failed",
        `HTML parsing failed: ${truncateChars(message, 300).value}`,
        false,
      ),
    };
  }

  const title = normalizeText(document.title ?? "");
  const scriptCount = document.querySelectorAll("script").length;
  const shellMarker = Boolean(
    document.querySelector(
      "#__next,#app,#root,[data-reactroot],[data-react-root],[ng-version]",
    ),
  );

  for (const element of Array.from(
    document.querySelectorAll(REMOVED_ELEMENTS),
  )) {
    element.remove();
  }
  const bodyTextLength = [...normalizeText(document.body?.textContent ?? "")]
    .length;

  let root: Element | null = null;
  const warnings: Diagnostic[] = [];
  if (selector) {
    try {
      root = document.querySelector(selector);
    } catch {
      return {
        error: operationalError(
          "invalid_request",
          "selector must be a valid CSS selector",
          false,
        ),
      };
    }
    if (!root) {
      return {
        error: operationalError(
          "parse_failed",
          "selector did not match any element in the static document",
          false,
        ),
      };
    }
  } else if (mode === "full") {
    root = document.body ?? document.documentElement;
  } else {
    root =
      document.querySelector("main") ??
      document.querySelector('[role="main"]') ??
      document.querySelector("article") ??
      document.body ??
      document.documentElement;
    if (root === document.body || root === document.documentElement) {
      warnings.push({
        code: "main_content_fallback",
        message: "No main/article root was found; extracted the document body",
        source: "document",
      });
    }
  }

  if (!root) {
    return {
      error: operationalError(
        "parse_failed",
        "HTML document did not contain an extractable root",
        false,
      ),
    };
  }

  absolutizeLinks(root, finalUrl);
  let content: string;
  try {
    content = normalizeText(
      NodeHtmlMarkdown.translate(root.outerHTML, {
        codeBlockStyle: "fenced",
        bulletMarker: "-",
        keepDataImages: false,
        maxConsecutiveNewlines: 3,
        preferNativeParser: false,
        useInlineLinks: true,
      }),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      error: operationalError(
        "parse_failed",
        `HTML-to-Markdown conversion failed: ${truncateChars(message, 300).value}`,
        false,
      ),
    };
  }

  if (!content && normalizeText(root.textContent ?? "")) {
    content = normalizeText(root.textContent ?? "");
    warnings.push({
      code: "markdown_fallback",
      message:
        "Markdown conversion was empty; preserved normalized text instead",
      source: "document",
    });
  }
  if (shellMarker && scriptCount > 0 && bodyTextLength < 200) {
    warnings.push({
      code: "client_rendered_shell",
      message:
        "Static extraction appears incomplete; this page may require Playwright or another JavaScript-capable browser",
      source: "document",
    });
  }

  return {
    value: {
      content,
      ...(title ? { title: truncateChars(title, 300).value } : {}),
      extractor: "html:linkedom+node-html-markdown@1",
      warnings,
    },
  };
}

export function normalizeDocument(
  body: string,
  contentType: string,
  finalUrl: string,
  mode: DocumentMode,
  selector?: string,
): NormalizeDocumentResult {
  let mime = mimeType(contentType);
  if (mime === "application/octet-stream" || !mime) {
    mime = /^\s*(?:<!doctype\s+html|<html|<head|<body|<main|<article)\b/i.test(
      body,
    )
      ? "text/html"
      : "text/plain";
  }

  if (mime === "text/html" || mime === "application/xhtml+xml") {
    return htmlDocument(body, finalUrl, mode, selector);
  }
  if (selector) {
    return {
      error: operationalError(
        "invalid_request",
        "selector is supported only for HTML documents",
        false,
      ),
    };
  }
  if (mime === "application/json" || mime.endsWith("+json")) {
    try {
      const parsed: unknown = JSON.parse(body);
      return {
        value: {
          content: normalizeText(JSON.stringify(parsed, null, 2)),
          extractor: "native:json@1",
          warnings: [],
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        error: operationalError(
          "parse_failed",
          `JSON parsing failed: ${truncateChars(message, 300).value}`,
          false,
        ),
      };
    }
  }
  if (
    mime.startsWith("text/") ||
    mime === "application/xml" ||
    mime.endsWith("+xml")
  ) {
    const extractor =
      mime === "text/markdown" || mime === "text/x-markdown"
        ? "native:markdown@1"
        : "native:text@1";
    return {
      value: { content: normalizeText(body), extractor, warnings: [] },
    };
  }

  return {
    error: operationalError(
      "parse_failed",
      `Unsupported document content type ${JSON.stringify(contentType)}`,
      false,
    ),
  };
}
