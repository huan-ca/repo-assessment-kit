#!/usr/bin/env node

import { closeSync, fsyncSync, lstatSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

export const ENGAGEMENT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/u;

export class EngagementIdError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "EngagementIdError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new EngagementIdError(code, message);
}

function readExisting(filePath) {
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    fail("unreadable", "The .rak_id file could not be inspected.");
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail("unsafe_file", "The .rak_id path must be a regular file, not a link or directory.");
  }
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
    fail("wrong_owner", "The .rak_id file must be owned by the current user.");
  }
  if ((stat.mode & 0o077) !== 0) {
    fail("unsafe_permissions", "The .rak_id file must not be accessible by other users.");
  }
  if (stat.size < 1 || stat.size > 49) {
    fail("invalid_file", "The .rak_id file has an invalid length.");
  }
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    fail("unreadable", "The .rak_id file could not be read.");
  }
  const value = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!ENGAGEMENT_ID_PATTERN.test(value) || text !== `${value}${text.endsWith("\n") ? "\n" : ""}`) {
    fail("invalid_file", "The .rak_id file must contain one valid lowercase identifier.");
  }
  return value;
}

export function resolveEngagementId({ filePath, override = "" }) {
  if (override !== "") {
    if (!ENGAGEMENT_ID_PATTERN.test(override)) {
      fail(
        "invalid_override",
        "RAK_ENGAGEMENT_ID must be a lowercase identifier of 1-48 letters, numbers, or hyphens.",
      );
    }
    return override;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = readExisting(filePath);
    if (existing !== null) return existing;

    const generated = `rak-${randomBytes(12).toString("hex")}`;
    let descriptor;
    try {
      descriptor = openSync(filePath, "wx", 0o600);
      writeFileSync(descriptor, `${generated}\n`, "utf8");
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
      return readExisting(filePath);
    } catch (error) {
      if (descriptor !== undefined) {
        try {
          closeSync(descriptor);
        } catch {
          // Preserve the original failure.
        }
      }
      if (error?.code === "EEXIST") continue;
      fail("create_failed", "A private .rak_id file could not be created.");
    }
  }
  fail("create_race", "The .rak_id file changed repeatedly while it was being created.");
}

function main() {
  if (process.argv.length !== 4 || process.argv[2] !== "--file") {
    process.stderr.write("usage: engagement-id.mjs --file <repository/.rak_id>\n");
    process.exitCode = 64;
    return;
  }
  try {
    const value = resolveEngagementId({
      filePath: process.argv[3],
      override: process.env.RAK_ENGAGEMENT_ID ?? "",
    });
    process.stdout.write(`${value}\n`);
  } catch (error) {
    const code = error instanceof EngagementIdError ? error.code : "unexpected";
    process.stderr.write(`RAK_ID_ERROR code=${code}\n`);
    process.exitCode = 78;
  }
}

if (process.argv[1] === new URL(import.meta.url).pathname) main();
