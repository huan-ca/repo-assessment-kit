import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { ENGAGEMENT_ID_PATTERN, EngagementIdError, resolveEngagementId } from "./engagement-id.mjs";

describe("engagement identity", () => {
  it("creates one private ID and reuses it", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "rak-id-"));
    const filePath = path.join(directory, ".rak_id");
    try {
      const first = resolveEngagementId({ filePath });
      const second = resolveEngagementId({ filePath });
      assert.equal(second, first);
      assert.match(first, ENGAGEMENT_ID_PATTERN);
      assert.equal(readFileSync(filePath, "utf8"), `${first}\n`);
      assert.equal(statSync(filePath).mode & 0o777, 0o600);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("uses a valid managed override without writing a file", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "rak-id-"));
    const filePath = path.join(directory, ".rak_id");
    try {
      assert.equal(
        resolveEngagementId({ filePath, override: "managed-engagement-1" }),
        "managed-engagement-1",
      );
      assert.throws(() => readFileSync(filePath), { code: "ENOENT" });
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("rejects invalid overrides and unsafe existing files", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "rak-id-"));
    const filePath = path.join(directory, ".rak_id");
    try {
      assert.throws(
        () => resolveEngagementId({ filePath, override: "../../shared" }),
        (error) => error instanceof EngagementIdError && error.code === "invalid_override",
      );

      writeFileSync(filePath, "valid-id\n", { mode: 0o600 });
      chmodSync(filePath, 0o644);
      assert.throws(
        () => resolveEngagementId({ filePath }),
        (error) => error instanceof EngagementIdError && error.code === "unsafe_permissions",
      );

      rmSync(filePath);
      symlinkSync(path.join(directory, "elsewhere"), filePath);
      assert.throws(
        () => resolveEngagementId({ filePath }),
        (error) => error instanceof EngagementIdError && error.code === "unsafe_file",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
