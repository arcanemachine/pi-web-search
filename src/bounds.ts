import type { JsonObject, JsonValue } from "./contracts.js";

export interface JsonBounds {
  maxDepth: number;
  maxEntries: number;
  maxArrayItems: number;
  maxStringBytes: number;
}

export interface BoundedJson {
  value: JsonObject;
  truncated: boolean;
  originalBytes: number;
  outputBytes: number;
}

export const DEFAULT_JSON_BOUNDS: Readonly<JsonBounds> = Object.freeze({
  maxDepth: 8,
  maxEntries: 100,
  maxArrayItems: 100,
  maxStringBytes: 4_096,
});

export function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

export function truncateChars(
  value: string,
  maxChars: number,
  suffix = "…",
): { value: string; truncated: boolean } {
  const characters = [...value];
  const limit = Math.max(0, Math.floor(maxChars));
  if (characters.length <= limit) return { value, truncated: false };
  if (limit === 0) return { value: "", truncated: true };
  if (limit === 1) return { value: suffix.slice(0, 1), truncated: true };
  return {
    value: `${characters.slice(0, limit - 1).join("")}${suffix}`,
    truncated: true,
  };
}

export function truncateUtf8(
  value: string,
  maxBytes: number,
  suffix = "…",
): { value: string; truncated: boolean } {
  const limit = Math.max(0, Math.floor(maxBytes));
  if (byteLength(value) <= limit) return { value, truncated: false };
  if (limit === 0) return { value: "", truncated: true };

  const suffixBytes = byteLength(suffix);
  const contentLimit = suffixBytes < limit ? limit - suffixBytes : limit;
  let output = "";
  let used = 0;
  for (const character of value) {
    const size = byteLength(character);
    if (used + size > contentLimit) break;
    output += character;
    used += size;
  }

  if (suffixBytes < limit) output += suffix;
  return { value: output, truncated: true };
}

function jsonBytes(value: JsonValue): number {
  return byteLength(JSON.stringify(value));
}

function toBoundedJsonValue(
  value: unknown,
  bounds: JsonBounds,
  state: { truncated: boolean; entries: number; seen: WeakSet<object> },
  depth: number,
): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    if (typeof value !== "string") return value;
    const bounded = truncateUtf8(value, bounds.maxStringBytes);
    if (bounded.truncated) state.truncated = true;
    return bounded.value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      state.truncated = true;
      return null;
    }
    return value;
  }
  if (typeof value === "bigint") {
    state.truncated = true;
    return value.toString();
  }
  if (
    value === undefined ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    state.truncated = true;
    return null;
  }
  if (depth >= bounds.maxDepth) {
    state.truncated = true;
    return "[depth limit]";
  }
  if (state.seen.has(value)) {
    state.truncated = true;
    return "[circular]";
  }
  state.seen.add(value);

  if (Array.isArray(value)) {
    const result: JsonValue[] = [];
    const count = Math.min(value.length, bounds.maxArrayItems);
    if (count < value.length) state.truncated = true;
    for (let index = 0; index < count; index += 1) {
      result.push(toBoundedJsonValue(value[index], bounds, state, depth + 1));
    }
    state.seen.delete(value);
    return result;
  }

  const result: JsonObject = {};
  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  for (const [key, item] of entries) {
    if (state.entries >= bounds.maxEntries) {
      state.truncated = true;
      break;
    }
    state.entries += 1;
    result[key] = toBoundedJsonValue(item, bounds, state, depth + 1);
  }
  state.seen.delete(value);
  return result;
}

export function toBoundedJsonObject(
  value: unknown,
  bounds: JsonBounds = DEFAULT_JSON_BOUNDS,
): { value: JsonObject; truncated: boolean } {
  const state = { truncated: false, entries: 0, seen: new WeakSet<object>() };
  const bounded = toBoundedJsonValue(value, bounds, state, 0);
  if (
    bounded !== null &&
    typeof bounded === "object" &&
    !Array.isArray(bounded)
  ) {
    return { value: bounded, truncated: state.truncated };
  }
  return {
    value: { value: bounded },
    truncated: true,
  };
}

export function boundJsonObjectBytes(
  value: unknown,
  maxBytes: number,
  initialBounds: JsonBounds = DEFAULT_JSON_BOUNDS,
): BoundedJson {
  const originalJson = (() => {
    try {
      return JSON.stringify(value) ?? "null";
    } catch {
      return "[unserializable]";
    }
  })();
  const limit = Math.max(128, Math.floor(maxBytes));
  let maxArrayItems = initialBounds.maxArrayItems;
  let maxStringBytes = initialBounds.maxStringBytes;

  for (let attempt = 0; attempt < 16; attempt += 1) {
    const bounded = toBoundedJsonObject(value, {
      ...initialBounds,
      maxArrayItems,
      maxStringBytes,
    });
    const outputBytes = jsonBytes(bounded.value);
    if (outputBytes <= limit) {
      return {
        value: bounded.value,
        truncated: bounded.truncated || outputBytes < byteLength(originalJson),
        originalBytes: byteLength(originalJson),
        outputBytes,
      };
    }
    maxArrayItems = Math.max(0, Math.floor(maxArrayItems / 2));
    maxStringBytes = Math.max(16, Math.floor(maxStringBytes / 2));
  }

  const fallback: JsonObject = {
    status: "error",
    summary: truncateUtf8("Output exceeded the configured details budget", 80)
      .value,
    format: { truncated: true },
  };
  return {
    value: fallback,
    truncated: true,
    originalBytes: byteLength(originalJson),
    outputBytes: jsonBytes(fallback),
  };
}
