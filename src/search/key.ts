import { createHash } from "node:crypto";
import type { PiWebSearchConfig } from "../config.js";
import type { SearchRequest } from "../contracts.js";

export function searchCacheKey(
  request: SearchRequest,
  config: PiWebSearchConfig,
): string {
  const semantic = JSON.stringify({
    backends: config.backends,
    query: request.query,
    limit: request.limit,
    region: request.region,
    safeSearch: request.safeSearch,
    timeRange: request.timeRange,
  });
  return createHash("sha256").update(semantic).digest("hex");
}
