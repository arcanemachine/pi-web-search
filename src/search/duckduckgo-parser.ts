import { JSDOM } from "jsdom";
import type { SearchResult } from "../contracts.js";

const DUCKDUCKGO_ORIGIN = "https://html.duckduckgo.com";

export type DuckDuckGoParseResult =
  | { kind: "results"; results: SearchResult[] }
  | { kind: "no_results" }
  | { kind: "blocked" }
  | { kind: "invalid"; message: string };

function normalizeText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function isDuckDuckGoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "duckduckgo.com" || host.endsWith(".duckduckgo.com");
}

export function normalizeDuckDuckGoUrl(raw: string): string | undefined {
  if (!raw.trim()) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(raw.trim(), DUCKDUCKGO_ORIGIN);
  } catch {
    return undefined;
  }

  if (parsed.username || parsed.password) return undefined;

  if (isDuckDuckGoHost(parsed.hostname)) {
    const uddg = parsed.searchParams.get("uddg");
    const oldDestination =
      uddg === null && parsed.searchParams.has("sa")
        ? parsed.searchParams.get("q")
        : null;
    const destination = uddg ?? oldDestination;
    if (destination !== null) {
      try {
        parsed = new URL(destination.trim());
      } catch {
        return undefined;
      }
    }
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return undefined;
  }
  if (parsed.username || parsed.password) return undefined;
  if (isDuckDuckGoHost(parsed.hostname)) return undefined;
  return parsed.toString();
}

function challengeEvidence(document: Document): boolean {
  const dedicated = document.querySelectorAll(
    [
      "#challenge",
      "#challenge-form",
      "#captcha",
      "#anomaly-modal",
      ".challenge",
      ".challenge-form",
      ".captcha",
      ".anomaly-modal",
      '[id*="captcha" i]',
      '[class*="captcha" i]',
      '[id*="anomaly" i]',
      '[class*="anomaly" i]',
      '[id*="challenge" i]',
      '[class*="challenge" i]',
    ].join(", "),
  );
  if (
    Array.from(dedicated).some((element) => !element.closest(".links_main"))
  ) {
    return true;
  }

  const body = document.body;
  if (!body) return false;
  const copy = body.cloneNode(true) as HTMLElement;
  copy
    .querySelectorAll("script, style, noscript, template")
    .forEach((node) => node.remove());
  copy.querySelectorAll(".links_main").forEach((node) => {
    (node.closest(".result") ?? node).remove();
  });
  const text = normalizeText(copy.textContent ?? "").toLowerCase();
  return /unusual\s+traffic|automated\s+(?:queries|requests)|verify\s+(?:that\s+)?you(?:'|’)re\s+human|too\s+many\s+requests|access\s+denied|\bcaptcha\b|\brate[ -]?limit(?:ed|ing)?\b/u.test(
    text,
  );
}

function recognizableSearchPage(document: Document): boolean {
  if (document.querySelector("#links, .serp__results, .results")) return true;

  const queryInput = document.querySelector(
    'input[name="q"], #search_form_input_homepage, .search__input',
  );
  const searchForm = document.querySelector(
    'form[action*="/html" i], form.header__form, form.search__form, form#search_form',
  );
  return Boolean(queryInput && searchForm);
}

export function parseDuckDuckGoHtml(
  html: string,
  limit?: number,
): DuckDuckGoParseResult {
  let document: Document;
  try {
    document = new JSDOM(html).window.document;
  } catch {
    return { kind: "invalid", message: "DuckDuckGo returned invalid HTML" };
  }

  if (challengeEvidence(document)) return { kind: "blocked" };

  const containers = Array.from(document.querySelectorAll(".links_main"));
  if (containers.length === 0) {
    if (recognizableSearchPage(document)) return { kind: "no_results" };
    return {
      kind: "invalid",
      message: "DuckDuckGo response was not a recognizable search page",
    };
  }

  const results: SearchResult[] = [];
  for (const [index, container] of containers.entries()) {
    const anchor = container.querySelector<HTMLAnchorElement>(
      ".result__title a[href]",
    );
    const title = normalizeText(anchor?.textContent ?? "");
    const rawUrl = anchor?.getAttribute("href") ?? "";
    const url = normalizeDuckDuckGoUrl(rawUrl);
    if (!title || !url) {
      return {
        kind: "invalid",
        message: `DuckDuckGo result ${index + 1} has an invalid title or URL`,
      };
    }

    const snippet = normalizeText(
      container.querySelector(".result__snippet")?.textContent ?? "",
    );
    results.push({ title, url, snippet });
  }

  const maximum =
    limit === undefined
      ? results.length
      : Math.max(
          0,
          Math.floor(Number.isFinite(limit) ? limit : results.length),
        );
  return { kind: "results", results: results.slice(0, maximum) };
}

export const parseDuckDuckGo = parseDuckDuckGoHtml;
