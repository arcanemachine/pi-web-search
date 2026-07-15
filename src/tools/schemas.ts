import { Type, type Static, type TSchema } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import {
  operationalError,
  type OperationalError,
  type ToolOperation,
} from "../contracts.js";

function StringEnum<const Values extends readonly string[]>(values: Values) {
  return Type.String({ enum: [...values] });
}

export const SearchWebParams = Type.Object(
  {
    query: Type.String({
      minLength: 1,
      description: "Precise web search query (1-500 characters after trimming)",
    }),
    limit: Type.Optional(
      Type.Integer({
        minimum: 1,
        description: "Maximum results; clamped to the configured hard cap",
      }),
    ),
    region: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 64,
        description: "Backend region/language code, such as us-en",
      }),
    ),
    safeSearch: Type.Optional(
      Type.String({
        enum: ["on", "off"],
        description: "Safe search mode (default: on)",
      }),
    ),
    timeRange: Type.Optional(
      Type.String({
        enum: ["day", "week", "month", "year"],
        description: "Optional recency filter",
      }),
    ),
    forceRefresh: Type.Optional(
      Type.Boolean({
        description:
          "Bypass completed cache entries, but never the rate limiter",
      }),
    ),
  },
  { additionalProperties: false },
);

export const ReadUrlContentParams = Type.Object(
  {
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
    mode: Type.Optional(StringEnum(["main", "full"] as const)),
    selector: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    maxChars: Type.Optional(Type.Integer({ minimum: 1 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
    forceRefresh: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export const GrepUrlContentParams = Type.Object(
  {
    url: Type.String({ minLength: 1, maxLength: 2_048 }),
    query: Type.String({ minLength: 1, maxLength: 500 }),
    beforeLines: Type.Optional(Type.Integer({ minimum: 0 })),
    afterLines: Type.Optional(Type.Integer({ minimum: 0 })),
    maxMatches: Type.Optional(Type.Integer({ minimum: 1 })),
    maxChars: Type.Optional(Type.Integer({ minimum: 1 })),
    caseSensitive: Type.Optional(Type.Boolean()),
    selector: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
    cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 2_048 })),
    forceRefresh: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type SearchWebParams = Static<typeof SearchWebParams>;
export type ReadUrlContentParams = Static<typeof ReadUrlContentParams>;
export type GrepUrlContentParams = Static<typeof GrepUrlContentParams>;

function invalid(message: string): OperationalError {
  return operationalError("invalid_request", message, false);
}

function schemaError(
  operation: ToolOperation,
  schema: TSchema,
  value: unknown,
): OperationalError | undefined {
  if (Value.Check(schema, value)) return undefined;
  return invalid(`${operation} arguments do not match the public schema`);
}

function validateHttpUrl(value: string): OperationalError | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return invalid("url must be a valid absolute URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return invalid("url must use HTTP or HTTPS");
  }
  if (url.username || url.password) {
    return invalid("url must not contain embedded credentials");
  }
  return undefined;
}

export function validateSearchWebRequest(
  value: unknown,
): OperationalError | undefined {
  const error = schemaError("search_web", SearchWebParams, value);
  if (error) return error;
  const request = value as SearchWebParams;
  const query = request.query.trim();
  if (!query) return invalid("query must not be blank");
  if ([...query].length > 500) {
    return invalid("query must not exceed 500 characters after trimming");
  }
  if (request.region !== undefined && !request.region.trim()) {
    return invalid("region must not be blank");
  }
  return undefined;
}

export function validateReadUrlContentRequest(
  value: unknown,
): OperationalError | undefined {
  const error = schemaError("read_url_content", ReadUrlContentParams, value);
  if (error) return error;
  const request = value as ReadUrlContentParams;
  const urlError = validateHttpUrl(request.url);
  if (urlError) return urlError;
  if (request.cursor && request.forceRefresh) {
    return invalid("cursor cannot be combined with forceRefresh");
  }
  return undefined;
}

export function validateGrepUrlContentRequest(
  value: unknown,
): OperationalError | undefined {
  const error = schemaError("grep_url_content", GrepUrlContentParams, value);
  if (error) return error;
  const request = value as GrepUrlContentParams;
  const urlError = validateHttpUrl(request.url);
  if (urlError) return urlError;
  if (!request.query.trim()) return invalid("query must not be blank");
  if (request.cursor && request.forceRefresh) {
    return invalid("cursor cannot be combined with forceRefresh");
  }
  return undefined;
}
