import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SearchBackendName } from "./contracts.js";

const PACKAGE_KEY = "pi-web-search";
const PROJECT_CONFIG_DIR = ".pi";
const PI_MAX_OUTPUT_BYTES = 50 * 1024;

export const SUMMARIZER_THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

export type SummarizerThinkingLevel =
  (typeof SUMMARIZER_THINKING_LEVELS)[number];

export interface PiWebSearchConfig {
  backends: SearchBackendName[];
  searxngUrl: string;
  braveApiKey?: string;
  searchTimeoutMs: number;
  searchCacheTtlSeconds: number;
  searchRateLimitPerMinute: number;
  searchRateLimitBurst: number;
  searchMaxResults: number;
  searchMaxLimitResults: number;
  searchMaxQueryChars: number;
  searchMaxTitleChars: number;
  searchMaxUrlChars: number;
  searchMaxSnippetChars: number;
  searchMaxOutputBytes: number;
  searchCacheMaxEntries: number;
  searchCacheMaxBytes: number;
  documentTimeoutMs: number;
  documentCacheTtlSeconds: number;
  documentMaxDownloadBytes: number;
  documentMaxNormalizedBytes: number;
  documentCacheMaxEntries: number;
  documentCacheMaxBytes: number;
  readMaxChars: number;
  readMaxLimitChars: number;
  grepMaxQueryChars: number;
  grepMaxContextLines: number;
  grepMaxMatches: number;
  grepMaxLimitMatches: number;
  grepMaxChars: number;
  grepMaxLimitChars: number;
  summarizationEnabled: boolean;
  summarizerModel?: string;
  summarizerThinkingLevel?: SummarizerThinkingLevel;
}

export const DEFAULT_CONFIG: Readonly<PiWebSearchConfig> = Object.freeze({
  backends: ["duckduckgo"] as SearchBackendName[],
  searxngUrl: "http://127.0.0.1:8080",
  searchTimeoutMs: 10_000,
  searchCacheTtlSeconds: 120,
  searchRateLimitPerMinute: 10,
  searchRateLimitBurst: 3,
  searchMaxResults: 5,
  searchMaxLimitResults: 10,
  searchMaxQueryChars: 500,
  searchMaxTitleChars: 300,
  searchMaxUrlChars: 2_048,
  searchMaxSnippetChars: 1_000,
  searchMaxOutputBytes: 24_576,
  searchCacheMaxEntries: 100,
  searchCacheMaxBytes: 2_097_152,
  documentTimeoutMs: 15_000,
  documentCacheTtlSeconds: 300,
  documentMaxDownloadBytes: 5_242_880,
  documentMaxNormalizedBytes: 2_097_152,
  documentCacheMaxEntries: 50,
  documentCacheMaxBytes: 10_485_760,
  readMaxChars: 12_000,
  readMaxLimitChars: 40_000,
  grepMaxQueryChars: 500,
  grepMaxContextLines: 20,
  grepMaxMatches: 1_000,
  grepMaxLimitMatches: 1_000,
  grepMaxChars: 40_000,
  grepMaxLimitChars: 40_000,
  summarizationEnabled: true,
});

const NUMERIC_KEYS = [
  "searchTimeoutMs",
  "searchCacheTtlSeconds",
  "searchRateLimitPerMinute",
  "searchRateLimitBurst",
  "searchMaxResults",
  "searchMaxLimitResults",
  "searchMaxQueryChars",
  "searchMaxTitleChars",
  "searchMaxUrlChars",
  "searchMaxSnippetChars",
  "searchMaxOutputBytes",
  "searchCacheMaxEntries",
  "searchCacheMaxBytes",
  "documentTimeoutMs",
  "documentCacheTtlSeconds",
  "documentMaxDownloadBytes",
  "documentMaxNormalizedBytes",
  "documentCacheMaxEntries",
  "documentCacheMaxBytes",
  "readMaxChars",
  "readMaxLimitChars",
  "grepMaxQueryChars",
  "grepMaxContextLines",
  "grepMaxMatches",
  "grepMaxLimitMatches",
  "grepMaxChars",
  "grepMaxLimitChars",
] as const;

type NumericKey = (typeof NUMERIC_KEYS)[number];

const MAXIMUMS: Record<NumericKey, number> = {
  searchTimeoutMs: 120_000,
  searchCacheTtlSeconds: 86_400,
  searchRateLimitPerMinute: 600,
  searchRateLimitBurst: 100,
  searchMaxResults: 25,
  searchMaxLimitResults: 25,
  searchMaxQueryChars: 500,
  searchMaxTitleChars: 10_000,
  searchMaxUrlChars: 10_000,
  searchMaxSnippetChars: 10_000,
  searchMaxOutputBytes: PI_MAX_OUTPUT_BYTES - 1_024,
  searchCacheMaxEntries: 10_000,
  searchCacheMaxBytes: 1_073_741_824,
  documentTimeoutMs: 120_000,
  documentCacheTtlSeconds: 86_400,
  documentMaxDownloadBytes: 104_857_600,
  documentMaxNormalizedBytes: 52_428_800,
  documentCacheMaxEntries: 10_000,
  documentCacheMaxBytes: 1_073_741_824,
  readMaxChars: 40_000,
  readMaxLimitChars: 40_000,
  grepMaxQueryChars: 10_000,
  grepMaxContextLines: 1_000,
  grepMaxMatches: 1_000,
  grepMaxLimitMatches: 1_000,
  grepMaxChars: 40_000,
  grepMaxLimitChars: 40_000,
};

const KNOWN_KEYS = new Set<string>([
  "backends",
  "searxngUrl",
  "braveApiKey",
  "summarizationEnabled",
  "summarizerModel",
  "summarizerThinkingLevel",
  ...NUMERIC_KEYS,
]);

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(`Invalid ${PACKAGE_KEY} configuration: ${message}`);
    this.name = "ConfigurationError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function packageSettings(
  settings: unknown,
  source: string,
): Record<string, unknown> {
  if (!isRecord(settings)) {
    throw new ConfigurationError(
      `${source} settings must contain a JSON object`,
    );
  }

  const value = settings[PACKAGE_KEY];
  if (value === undefined) return {};
  if (!isRecord(value)) {
    throw new ConfigurationError(
      `${source} ${PACKAGE_KEY} value must be an object`,
    );
  }
  return value;
}

function validateKnownKeys(value: Record<string, unknown>): void {
  for (const key of Object.keys(value)) {
    if (!KNOWN_KEYS.has(key)) {
      throw new ConfigurationError(`unknown property ${JSON.stringify(key)}`);
    }
  }
}

function normalizeBackends(value: unknown): SearchBackendName[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ConfigurationError("backends must be a non-empty array");
  }

  const backends: SearchBackendName[] = [];
  for (const item of value) {
    if (typeof item !== "string" || !item.trim()) {
      throw new ConfigurationError("backends must contain non-empty strings");
    }
    const backend = item.trim().toLowerCase();
    if (
      backend !== "duckduckgo" &&
      backend !== "searxng" &&
      backend !== "brave"
    ) {
      throw new ConfigurationError(
        `unknown backend ${JSON.stringify(item)}; supported backends are duckduckgo, searxng, and brave`,
      );
    }
    if (backends.includes(backend)) {
      throw new ConfigurationError(
        `duplicate backend ${JSON.stringify(backend)}`,
      );
    }
    backends.push(backend);
  }
  return backends;
}

function normalizeSearxngUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConfigurationError("searxngUrl must be a non-empty string");
  }

  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new ConfigurationError("searxngUrl must be a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ConfigurationError("searxngUrl must use HTTP or HTTPS");
  }
  return parsed.toString().replace(/\/$/, "");
}

function normalizeBraveApiKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConfigurationError("braveApiKey must be a non-empty string");
  }
  return value.trim();
}

function normalizePositiveInteger(key: NumericKey, value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ConfigurationError(`${key} must be a finite number`);
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new ConfigurationError(`${key} must be a positive integer`);
  }
  if (value > MAXIMUMS[key]) {
    throw new ConfigurationError(
      `${key} exceeds the supported maximum of ${MAXIMUMS[key]}`,
    );
  }
  return value;
}

function envOverrides(
  env: Readonly<Record<string, string | undefined>>,
  configured: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const searxngUrl = env.SEARXNG_URL?.trim();
  if (configured.searxngUrl === undefined && searxngUrl) {
    result.searxngUrl = searxngUrl;
  }

  const braveApiKey = env.BRAVE_SEARCH_API_KEY?.trim();
  if (braveApiKey) result.braveApiKey = braveApiKey;

  const ttlMinutes = env.CACHE_TTL_MINUTES?.trim();
  if (configured.documentCacheTtlSeconds === undefined && ttlMinutes) {
    const parsed = Number(ttlMinutes);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new ConfigurationError(
        "CACHE_TTL_MINUTES compatibility fallback must be a positive number",
      );
    }
    const seconds = parsed * 60;
    if (!Number.isInteger(seconds)) {
      throw new ConfigurationError(
        "CACHE_TTL_MINUTES must resolve to a whole number of seconds",
      );
    }
    result.documentCacheTtlSeconds = seconds;
  }
  return result;
}

function normalizeSummarizerThinkingLevel(
  value: unknown,
): SummarizerThinkingLevel {
  if (
    typeof value !== "string" ||
    !SUMMARIZER_THINKING_LEVELS.includes(value as SummarizerThinkingLevel)
  ) {
    throw new ConfigurationError(
      `summarizerThinkingLevel must be one of ${SUMMARIZER_THINKING_LEVELS.join(", ")}`,
    );
  }
  return value as SummarizerThinkingLevel;
}

function normalizeSummarizerModel(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new ConfigurationError(
      "summarizerModel must be a non-empty provider/model string",
    );
  }
  const model = value.trim();
  if ([...model].length > 500) {
    throw new ConfigurationError(
      "summarizerModel must not exceed 500 characters",
    );
  }
  const separator = model.indexOf("/");
  if (
    separator <= 0 ||
    separator === model.length - 1 ||
    /\s/.test(model.slice(0, separator)) ||
    /\s/.test(model.slice(separator + 1))
  ) {
    throw new ConfigurationError(
      "summarizerModel must use provider/model syntax",
    );
  }
  return model;
}

function validateRelationships(config: PiWebSearchConfig): void {
  if (config.searchMaxResults > config.searchMaxLimitResults) {
    throw new ConfigurationError(
      "searchMaxResults must not exceed searchMaxLimitResults",
    );
  }
  if (config.readMaxChars > config.readMaxLimitChars) {
    throw new ConfigurationError(
      "readMaxChars must not exceed readMaxLimitChars",
    );
  }
  if (config.grepMaxMatches > config.grepMaxLimitMatches) {
    throw new ConfigurationError(
      "grepMaxMatches must not exceed grepMaxLimitMatches",
    );
  }
  if (config.grepMaxChars > config.grepMaxLimitChars) {
    throw new ConfigurationError(
      "grepMaxChars must not exceed grepMaxLimitChars",
    );
  }
  if (config.documentMaxNormalizedBytes > config.documentCacheMaxBytes) {
    throw new ConfigurationError(
      "documentMaxNormalizedBytes must not exceed documentCacheMaxBytes",
    );
  }
  if (config.searchMaxOutputBytes > config.searchCacheMaxBytes) {
    throw new ConfigurationError(
      "searchMaxOutputBytes must not exceed searchCacheMaxBytes",
    );
  }
}

export function resolveConfig(
  globalSettings: unknown,
  projectSettings: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): PiWebSearchConfig {
  const globalConfig = packageSettings(globalSettings, "global");
  const projectConfig = packageSettings(projectSettings, "project");
  validateKnownKeys(globalConfig);
  validateKnownKeys(projectConfig);

  const configured: Record<string, unknown> = {
    ...globalConfig,
    ...projectConfig,
  };
  const merged: Record<string, unknown> = {
    ...envOverrides(env, configured),
    ...configured,
  };
  const config: PiWebSearchConfig = {
    ...DEFAULT_CONFIG,
    backends: [...DEFAULT_CONFIG.backends],
  };
  const writable = config as unknown as Record<string, unknown>;

  if (merged.backends !== undefined) {
    config.backends = normalizeBackends(merged.backends);
  }
  if (merged.searxngUrl !== undefined) {
    config.searxngUrl = normalizeSearxngUrl(merged.searxngUrl);
  }
  if (merged.braveApiKey !== undefined) {
    config.braveApiKey = normalizeBraveApiKey(merged.braveApiKey);
  }
  if (merged.summarizationEnabled !== undefined) {
    if (typeof merged.summarizationEnabled !== "boolean") {
      throw new ConfigurationError("summarizationEnabled must be a boolean");
    }
    config.summarizationEnabled = merged.summarizationEnabled;
  }
  if (merged.summarizerModel !== undefined) {
    config.summarizerModel = normalizeSummarizerModel(merged.summarizerModel);
  }
  if (merged.summarizerThinkingLevel !== undefined) {
    config.summarizerThinkingLevel = normalizeSummarizerThinkingLevel(
      merged.summarizerThinkingLevel,
    );
  }
  for (const key of NUMERIC_KEYS) {
    if (merged[key] !== undefined) {
      writable[key] = normalizePositiveInteger(key, merged[key]);
    }
  }

  validateRelationships(config);
  return config;
}

function readSettingsFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ConfigurationError(`cannot parse ${path}: ${message}`);
  }
  if (!isRecord(parsed)) {
    throw new ConfigurationError(`${path} must contain a JSON object`);
  }
  return parsed;
}

export interface LoadConfigOptions {
  includeProject?: boolean;
  env?: Readonly<Record<string, string | undefined>>;
  globalSettingsPath?: string;
}

export function loadConfig(
  cwd: string,
  options: LoadConfigOptions = {},
): PiWebSearchConfig {
  const globalPath =
    options.globalSettingsPath ?? join(getAgentDir(), "settings.json");
  const projectPath = join(cwd, PROJECT_CONFIG_DIR, "settings.json");
  return resolveConfig(
    readSettingsFile(globalPath),
    options.includeProject === false ? {} : readSettingsFile(projectPath),
    options.env ?? process.env,
  );
}

export interface ConfigStore {
  get(): PiWebSearchConfig;
  refresh(cwd: string, includeProject: boolean): PiWebSearchConfig;
}

export function createConfigStore(): ConfigStore {
  let current = loadConfig(process.cwd(), { includeProject: false });
  return {
    get: () => current,
    refresh(cwd, includeProject) {
      current = loadConfig(cwd, { includeProject });
      return current;
    },
  };
}
