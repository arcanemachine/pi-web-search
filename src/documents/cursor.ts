import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { operationalError, type OperationalError } from "../contracts.js";

export type CursorOperation = "read";

export interface CursorState {
  snapshotId: string;
  operation: CursorOperation;
  position: number;
  optionsHash: string;
}

export type CursorDecodeResult =
  | { value: CursorState; error?: never }
  | { value?: never; error: OperationalError };

interface EncodedCursor {
  v: 1;
  s: string;
  o: CursorOperation;
  p: number;
  x: string;
}

function isEncodedCursor(value: unknown): value is EncodedCursor {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return (
    item.v === 1 &&
    typeof item.s === "string" &&
    item.o === "read" &&
    typeof item.p === "number" &&
    Number.isSafeInteger(item.p) &&
    item.p >= 0 &&
    typeof item.x === "string"
  );
}

export function optionsHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url");
}

export class CursorService {
  constructor(private readonly secret: Uint8Array = randomBytes(32)) {}

  encode(state: CursorState): string {
    const payload: EncodedCursor = {
      v: 1,
      s: state.snapshotId,
      o: state.operation,
      p: state.position,
      x: state.optionsHash,
    };
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.secret)
      .update(encoded)
      .digest("base64url");
    return `${encoded}.${signature}`;
  }

  decode(
    token: string,
    operation: CursorOperation,
    expectedOptionsHash: string,
  ): CursorDecodeResult {
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra !== undefined) {
      return this.invalid("cursor has an invalid shape");
    }
    const expected = createHmac("sha256", this.secret).update(encoded).digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(signature, "base64url");
    } catch {
      return this.invalid("cursor signature is invalid");
    }
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      return this.invalid("cursor signature is invalid");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      return this.invalid("cursor payload is invalid");
    }
    if (!isEncodedCursor(parsed)) {
      return this.invalid("cursor payload is invalid");
    }
    if (parsed.o !== operation) {
      return this.invalid(`cursor belongs to the ${parsed.o} operation`);
    }
    if (parsed.x !== expectedOptionsHash) {
      return this.invalid("cursor conflicts with the supplied URL or options");
    }
    return {
      value: {
        snapshotId: parsed.s,
        operation: parsed.o,
        position: parsed.p,
        optionsHash: parsed.x,
      },
    };
  }

  private invalid(message: string): CursorDecodeResult {
    return {
      error: operationalError("invalid_request", message, false),
    };
  }
}
