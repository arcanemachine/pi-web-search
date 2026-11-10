import {
  operationalError,
  type Diagnostic,
  type OperationalError,
  type SearchResult,
} from "../contracts.js";

export type PayloadResult<T> =
  { ok: true; value: T } | { ok: false; error: OperationalError };

export interface SearxngPayload {
  results: SearchResult[];
  diagnostics: Diagnostic[];
}

export interface BravePayload {
  results: SearchResult[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseError(message: string): PayloadResult<never> {
  return {
    ok: false,
    error: operationalError("parse_failed", message, false),
  };
}

function validateResultUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    if (parsed.username || parsed.password) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function normalizeResult(value: unknown): SearchResult | undefined {
  if (!isRecord(value)) return undefined;
  const title = typeof value.title === "string" ? value.title.trim() : "";
  const url = validateResultUrl(value.url);
  const snippetValue = value.content;
  const snippet = typeof snippetValue === "string" ? snippetValue.trim() : "";
  if (!title || !url) return undefined;

  const engine = typeof value.engine === "string" ? value.engine.trim() : "";
  return {
    title,
    url,
    snippet,
    ...(engine ? { engine } : {}),
  };
}

function parseUnresponsiveEngines(value: unknown): PayloadResult<Diagnostic[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return parseError("SearXNG unresponsive_engines must be an array");
  }

  const diagnostics: Diagnostic[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (
      !Array.isArray(item) ||
      item.length < 2 ||
      typeof item[0] !== "string" ||
      typeof item[1] !== "string"
    ) {
      return parseError(
        `SearXNG unresponsive_engines entry ${index + 1} is malformed`,
      );
    }
    diagnostics.push({
      code: "engine_unresponsive",
      message: `${item[0]}: ${item[1]}`,
      source: "searxng",
    });
  }
  return { ok: true, value: diagnostics };
}

export function parseSearxngPayload(
  value: unknown,
): PayloadResult<SearxngPayload> {
  if (!isRecord(value)) return parseError("SearXNG response must be an object");
  if (!Array.isArray(value.results)) {
    return parseError("SearXNG response results must be an array");
  }

  const results: SearchResult[] = [];
  for (let index = 0; index < value.results.length; index += 1) {
    const result = normalizeResult(value.results[index]);
    if (!result) {
      return parseError(
        `SearXNG result ${index + 1} has an invalid title or URL`,
      );
    }
    results.push(result);
  }

  const diagnostics = parseUnresponsiveEngines(value.unresponsive_engines);
  if (!diagnostics.ok) return diagnostics;
  return {
    ok: true,
    value: { results, diagnostics: diagnostics.value },
  };
}

export function parseBravePayload(value: unknown): PayloadResult<BravePayload> {
  if (!isRecord(value))
    return parseError("Brave Search response must be an object");
  const web = value.web;
  if (web === undefined || web === null)
    return { ok: true, value: { results: [] } };
  if (!isRecord(web))
    return parseError("Brave Search response web must be an object");
  if (!Array.isArray(web.results)) {
    return parseError("Brave Search response web.results must be an array");
  }

  const results: SearchResult[] = [];
  for (let index = 0; index < web.results.length; index += 1) {
    const item = web.results[index];
    if (!isRecord(item)) {
      return parseError(`Brave Search result ${index + 1} is malformed`);
    }
    const title = typeof item.title === "string" ? item.title.trim() : "";
    const url = validateResultUrl(item.url);
    if (!title || !url) {
      return parseError(
        `Brave Search result ${index + 1} has an invalid title or URL`,
      );
    }
    const description =
      typeof item.description === "string" ? item.description.trim() : "";
    results.push({ title, url, snippet: description, engine: "brave" });
  }

  return { ok: true, value: { results } };
}
