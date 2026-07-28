import { createHash } from "node:crypto";

import type { Digest } from "./types.js";

function assertIJsonString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new Error("JCS_INVALID_UNICODE");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw new Error("JCS_INVALID_UNICODE");
    }
  }
}

function serialize(value: unknown): string {
  if (value === null || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "string") {
    assertIJsonString(value);
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("JCS_NON_FINITE_NUMBER");
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => serialize(item)).join(",")}]`;
  }
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const keys = Object.keys(object).sort();
    const entries = keys.map((key) => {
      assertIJsonString(key);
      const item = object[key];
      if (item === undefined) {
        throw new Error("JCS_UNDEFINED_VALUE");
      }
      return `${JSON.stringify(key)}:${serialize(item)}`;
    });
    return `{${entries.join(",")}}`;
  }
  throw new Error("JCS_UNSUPPORTED_VALUE");
}

export function canonicalize(value: unknown): Uint8Array {
  return Buffer.from(serialize(value), "utf8");
}

export function sha256Digest(bytes: Uint8Array): Digest {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
