import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import * as AjvModule from "ajv";
import * as Ajv2020Module from "ajv/dist/2020.js";
import * as AjvDraft04Module from "ajv-draft-04";
import * as AjvFormatsModule from "ajv-formats";

export type ReleaseSchemaKind = "native" | "sarif" | "cyclonedx";

interface CompanionAsset {
  path: string;
  sha256: string;
}

export interface ReleaseSchemaAsset {
  id: string;
  kind: ReleaseSchemaKind;
  dialect: string;
  schemaId: string;
  path: string;
  sha256: string;
  source: string;
  sourceRevision: string;
  license: string;
  licensePath: string | null;
  companions?: CompanionAsset[];
}

export interface ReleaseSchemaRegistry {
  schemaVersion: "1.0.0";
  profile: "rak-schema-registry/1.0.0";
  assets: ReleaseSchemaAsset[];
}

export interface ReleaseSchemaValidation {
  status: "passed";
  schemaId: string;
  schemaDigest: string;
  registryDigest: string;
  validator: string;
  semanticProfile: string;
}

const assetsDirectory = fileURLToPath(new URL("../assets/", import.meta.url));
const registryPath = resolve(assetsDirectory, "schema-registry.json");
const digestPattern = /^[a-f0-9]{64}$/u;
type ValidationError = { instancePath?: string; dataPath?: string; message?: string };
type ValidateFunction = ((value: unknown) => boolean) & {
  errors?: null | readonly ValidationError[];
};
interface Validator {
  addSchema(schema: object, key?: string): Validator;
  addFormat(
    name: string,
    format: { type: "string"; validate: (value: string) => boolean },
  ): Validator;
  compile(schema: object): ValidateFunction;
}
type ValidatorConstructor = new (options: Record<string, unknown>) => Validator;
type FormatInstaller = (validator: Validator) => void;
const Ajv = AjvModule.default as unknown as ValidatorConstructor;
const Ajv2020 = Ajv2020Module.default as unknown as ValidatorConstructor;
const AjvDraft04 = AjvDraft04Module.default as unknown as ValidatorConstructor;
const addFormats = AjvFormatsModule.default as unknown as FormatInstaller;

function installExtendedFormats(validator: Validator): void {
  const hasControlOrSpace = (value: string, includeSpace: boolean): boolean =>
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint < (includeSpace ? 33 : 32) || codePoint === 127;
    });
  addFormats(validator);
  validator.addFormat("iri-reference", {
    type: "string",
    validate: (value) => value.length > 0 && !hasControlOrSpace(value, true),
  });
  validator.addFormat("idn-email", {
    type: "string",
    validate: (value) =>
      value.length <= 254 &&
      /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/u.test(value) &&
      !hasControlOrSpace(value, false),
  });
}

function parseJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !expected.includes(key));
  if (unknown.length > 0)
    throw new Error(`${label} contains unknown fields: ${unknown.join(", ")}`);
}

export function loadReleaseSchemaRegistry(): ReleaseSchemaRegistry {
  const parsed = parseJsonFile(registryPath);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new Error("Release schema registry must be an object");
  const registry = parsed as Record<string, unknown>;
  exactKeys(registry, ["schemaVersion", "profile", "assets"], "Release schema registry");
  if (
    registry["schemaVersion"] !== "1.0.0" ||
    registry["profile"] !== "rak-schema-registry/1.0.0" ||
    !Array.isArray(registry["assets"]) ||
    registry["assets"].length !== 3
  )
    throw new Error("Release schema registry identity or asset inventory is invalid");
  return parsed as ReleaseSchemaRegistry;
}

function resolveAssetPath(relativePath: string): string {
  const absolute = resolve(assetsDirectory, relativePath);
  const prefix = `${resolve(assetsDirectory)}/`;
  if (!absolute.startsWith(prefix))
    throw new Error(`Schema asset escapes registry: ${relativePath}`);
  return absolute;
}

function verifyOne(relativePath: string, expectedDigest: string): void {
  if (!digestPattern.test(expectedDigest))
    throw new Error(`Schema registry digest is invalid: ${relativePath}`);
  const actual = sha256(readFileSync(resolveAssetPath(relativePath)));
  if (actual !== expectedDigest) throw new Error(`Schema asset digest mismatch: ${relativePath}`);
}

export function verifyReleaseSchemaAssets(): {
  status: "passed";
  registryDigest: string;
  assets: Array<{ id: string; sha256: string }>;
} {
  const registry = loadReleaseSchemaRegistry();
  const seenKinds = new Set<ReleaseSchemaKind>();
  for (const asset of registry.assets) {
    if (seenKinds.has(asset.kind)) throw new Error(`Duplicate schema kind: ${asset.kind}`);
    seenKinds.add(asset.kind);
    if (
      asset.source.trim() === "" ||
      asset.sourceRevision.trim() === "" ||
      asset.license.trim() === ""
    )
      throw new Error(`Schema provenance is incomplete: ${asset.id}`);
    verifyOne(asset.path, asset.sha256);
    for (const companion of asset.companions ?? []) verifyOne(companion.path, companion.sha256);
    if (asset.licensePath !== null) {
      const license = readFileSync(resolveAssetPath(asset.licensePath), "utf8");
      if (license.trim().length < 80)
        throw new Error(`Schema license notice is incomplete: ${asset.id}`);
    }
  }
  if (seenKinds.size !== 3)
    throw new Error("Native, SARIF, and CycloneDX schemas are all required");
  return {
    status: "passed",
    registryDigest: sha256(readFileSync(registryPath)),
    assets: registry.assets.map(({ id, sha256 }) => ({ id, sha256 })),
  };
}

function findAsset(kind: ReleaseSchemaKind): ReleaseSchemaAsset {
  const asset = loadReleaseSchemaRegistry().assets.find((candidate) => candidate.kind === kind);
  if (asset === undefined) throw new Error(`Release schema is not registered: ${kind}`);
  return asset;
}

function assertValid(
  valid: boolean,
  errors:
    | null
    | undefined
    | readonly { instancePath?: string; dataPath?: string; message?: string }[],
  label: string,
): void {
  if (valid) return;
  const details = (errors ?? [])
    .slice(0, 12)
    .map((error) => `${error.instancePath ?? error.dataPath ?? "/"} ${error.message ?? "invalid"}`)
    .join("; ");
  throw new Error(`${label} official schema validation failed: ${details || "unknown violation"}`);
}

export function validateWithOfficialReleaseSchema(
  kind: ReleaseSchemaKind,
  value: unknown,
): ReleaseSchemaValidation {
  const verified = verifyReleaseSchemaAssets();
  const asset = findAsset(kind);
  const schema = parseJsonFile(resolveAssetPath(asset.path)) as object;

  if (kind === "sarif") {
    const validator = new AjvDraft04({
      allErrors: true,
      strict: false,
      validateFormats: true,
    });
    installExtendedFormats(validator);
    const validate = validator.compile(schema);
    assertValid(validate(value), validate.errors, "SARIF 2.1.0 Errata 01");
  } else if (kind === "cyclonedx") {
    const validator = new Ajv({
      allErrors: true,
      strict: false,
      validateFormats: true,
    });
    installExtendedFormats(validator);
    const schemaDirectory = dirname(resolveAssetPath(asset.path));
    for (const companion of asset.companions ?? []) {
      const companionSchema = parseJsonFile(resolve(assetsDirectory, companion.path)) as {
        $id?: string;
        id?: string;
      };
      const filename = companion.path.split("/").at(-1);
      if (filename === undefined) throw new Error("CycloneDX companion path is invalid");
      validator.addSchema(companionSchema, `http://cyclonedx.org/schema/${filename}`);
      validator.addSchema(companionSchema, filename);
    }
    const validate = validator.compile(schema);
    assertValid(validate(value), validate.errors, "CycloneDX 1.7");
    if (!schemaDirectory.startsWith(resolve(assetsDirectory)))
      throw new Error("CycloneDX schema directory escaped release assets");
  } else {
    const validator = new Ajv2020({
      allErrors: true,
      strict: true,
      validateFormats: true,
    });
    addFormats(validator);
    const validate = validator.compile(schema);
    assertValid(validate(value), validate.errors, "RAK repository assessment 1.0.0");
  }

  return {
    status: "passed",
    schemaId: asset.schemaId,
    schemaDigest: asset.sha256,
    registryDigest: verified.registryDigest,
    validator:
      kind === "sarif"
        ? "ajv-draft-04/1.0.0+ajv/8.20.0"
        : kind === "cyclonedx"
          ? "ajv/8.20.0-draft-07"
          : "ajv/8.20.0-draft-2020-12",
    semanticProfile: "rak-export-profile/1.0.0",
  };
}
