import { readFileSync, readdirSync } from "node:fs";
import Ajv2020Module from "ajv/dist/2020.js";
import addFormatsModule from "ajv-formats";
import { describe, expect, it } from "vitest";
import {
  createRunBodySchema,
  decisionComparisonSchema,
  dynamicControlPlanPayloadSchema,
  productClaimSchema,
  runDocumentSchema,
  signedDynamicControlPlanSchema,
  targetSnapshotSchema,
} from "./index.js";

const digest = `sha256:${"a".repeat(64)}` as const;
const timestamp = "2026-07-28T12:00:00.000Z";
const runId = "run_01982c12-2a00-7000-8000-000000000001";

describe("strict RAK contracts", () => {
  it("publishes strict Draft 2020-12 schemas and the frozen core operation IDs", () => {
    const ajv = new Ajv2020Module.default({ strict: true });
    addFormatsModule.default(ajv);
    const runSchema = JSON.parse(
      readFileSync(new URL("../schemas/rak/1.0/run-document.json", import.meta.url), "utf8"),
    ) as object;
    expect(ajv.compile(runSchema)).toBeTypeOf("function");
    const openapi = JSON.parse(
      readFileSync(new URL("../openapi.json", import.meta.url), "utf8"),
    ) as {
      paths: Record<
        string,
        Record<
          string,
          {
            operationId: string;
            parameters?: Array<{ $ref?: string }>;
            requestBody?: {
              content: { "application/json": { schema: { $ref?: string } } };
            };
            responses: Record<string, unknown>;
          }
        >
      >;
    };
    const operationIds = Object.values(openapi.paths).flatMap((path) =>
      Object.values(path).map((operation) => operation.operationId),
    );
    expect(operationIds).toEqual(
      expect.arrayContaining([
        "bootstrapSession",
        "createRun",
        "putDiscovery",
        "putApprovals",
        "resolveTarget",
        "startRun",
        "pauseRun",
        "resumeRun",
        "cancelRun",
        "rerunRuntimeGate",
        "listCoverage",
        "listFindings",
        "listEvidence",
        "getDecision",
        "createSecret",
        "uploadSecret",
        "revokeSecret",
        "createRevision",
        "createReview",
        "createPackage",
        "downloadPackage",
        "downloadPackageDigest",
        "requestRunDeletion",
        "getDeletionJob",
        "restoreRunDeletion",
        "streamEvents",
      ]),
    );
    for (const path of [
      "/runs/{runId}/actions/resolve-target",
      "/runs/{runId}/actions/start",
      "/runs/{runId}/actions/pause",
      "/runs/{runId}/actions/resume",
      "/runs/{runId}/actions/cancel",
      "/runs/{runId}/actions/runtime-gate",
      "/runs/{runId}/actions/validate",
      "/runs/{runId}/packages",
    ]) {
      const operation = openapi.paths[path]?.["post"];
      expect(operation?.parameters?.map((parameter) => parameter.$ref)).toEqual(
        expect.arrayContaining([
          "#/components/parameters/RunId",
          "#/components/parameters/IdempotencyKey",
          "#/components/parameters/IfMatch",
        ]),
      );
      expect(operation?.requestBody?.content["application/json"].schema.$ref).toMatch(
        /^#\/components\/schemas\//,
      );
    }
    expect(openapi.paths["/runs/{runId}/events"]?.["get"]?.responses).toHaveProperty("410");
    expect(JSON.stringify(openapi)).not.toContain("JsonResponse");
    const schemas = (openapi as unknown as { components: { schemas: Record<string, unknown> } })
      .components.schemas;
    const assertStrictObjects = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      const object = value as Record<string, unknown>;
      if (object["type"] === "object") expect(object["additionalProperties"]).toBe(false);
      for (const child of Object.values(object)) assertStrictObjects(child);
    };
    for (const schema of Object.values(schemas)) assertStrictObjects(schema);

    const schemasDirectory = new URL("../schemas/rak/1.0/", import.meta.url);
    const schemaNames = readdirSync(schemasDirectory).filter((name) => name.endsWith(".json"));
    expect(schemaNames.length).toBeGreaterThanOrEqual(15);
    for (const schemaName of schemaNames) {
      const schema = JSON.parse(
        readFileSync(new URL(schemaName, schemasDirectory), "utf8"),
      ) as object;
      const schemaAjv = new Ajv2020Module.default({ strict: true });
      addFormatsModule.default(schemaAjv);
      expect(schemaAjv.compile(schema), schemaName).toBeTypeOf("function");
    }
  });

  it("rejects unknown ProductClaim fields and invalid provenance seams", () => {
    const base = {
      schemaVersion: "1.0.0",
      claimId: "clm_1",
      runId,
      topic: "buyers",
      statement: "Procurement",
      provenance: "owner-stated",
      confidence: "high",
      evidenceOccurrenceIds: [],
      conflictsWithClaimIds: [],
      revision: 1,
    };
    expect(() => productClaimSchema.parse(base)).toThrow(/speakerRole/);
    expect(() =>
      productClaimSchema.parse({
        ...base,
        speakerRole: "owner",
        capturedAt: timestamp,
        unexpected: true,
      }),
    ).toThrow(/Unrecognized key/);
  });

  it("rejects noncanonical identities, timestamps, paths, and source-integrity drift", () => {
    expect(() =>
      createRunBodySchema.parse({
        projectSlug: "fixture",
        engagementId: "eng_fixture",
        provider: "codex",
        source: {
          kind: "local",
          sourceHandleId: "src_fixture",
          relativePath: "repo\u0000escape",
          mode: "commit-only",
        },
        selectedProfiles: [],
        optionalServiceIds: [],
      }),
    ).toThrow();
    expect(() =>
      runDocumentSchema.parse({
        schemaVersion: "1.0.0",
        runId: "run_not-a-uuid7",
        projectSlug: "fixture",
        revision: 1,
        rowVersion: 0,
        state: "DRAFT",
        workflowProfile: "rak-workflow/1.0.0",
        exportProfile: "rak-export-profile/1.0.0",
        provider: "codex",
        createdAt: "2026-07-28T01:00:00+01:00",
        updatedAt: timestamp,
        limitationIds: [],
      }),
    ).toThrow();
    expect(() =>
      targetSnapshotSchema.parse({
        schemaVersion: "1.0.0",
        snapshotId: digest,
        sourceKind: "local",
        sanitizedLocator: "registered/repo",
        gitObjectFormat: "sha1",
        commitSha: "a".repeat(40),
        baseCommitSha: "a".repeat(40),
        mode: "commit-only",
        manifestBlobId: "blb_fixture",
        manifestDigest: digest,
        archiveDigest: digest,
        beforeSourceDigest: digest,
        afterSourceDigest: `sha256:${"b".repeat(64)}`,
        includedDirtyPaths: [],
        excludedDirtyPaths: [],
        submodules: "not-present",
        lfs: "not-present",
        createdAt: timestamp,
      }),
    ).toThrow(/source integrity/);
    expect(() =>
      decisionComparisonSchema.parse({
        schemaVersion: "1.0.0",
        runId,
        criteria: [],
        recommendation: { kind: "single", option: "remediation" },
        rationale: "Remediate",
        confidence: "low",
        assumptions: [],
        dependencies: [],
        reversalConditions: [],
      }),
    ).toThrow(/seven decision criteria/);
  });

  it("materializes the corrected signed dynamic control plan and fails closed on expansion", () => {
    const payload = {
      schemaVersion: "1.0.0",
      controlPlanId: "dcp_1",
      runId,
      runtimeId: "rt_1",
      runtimeCreationNonce: "creation-1",
      attemptId: "att_1",
      fenceToken: "4",
      snapshotId: "snap_1",
      compiledPlanId: "compiled_1",
      compiledPlanDigest: digest,
      selectedProfileIds: ["rak-safe-dynamic/1.0.0"],
      approvalIds: [],
      authorityDigest: digest,
      internalOrigins: [{ scheme: "http", host: "service", port: 8080 }],
      controls: [
        {
          plannedControlId: "ctl_1",
          safetyClass: "P1-anonymous-read",
          internalOrigin: { scheme: "http", host: "service", port: 8080 },
          method: "GET",
          routeTemplate: "/health",
          fixtureIds: [],
          expectedSideEffects: [],
          budgets: {
            requests: 1,
            bytes: "4096",
            requestsPerSecond: 1,
            wallSeconds: 5,
            redirects: 0,
          },
          permittedOutputClass: "O0",
          abortTriggers: ["origin-drift"],
          cleanupAssertion: "no target mutation",
          coverageOnDenyOrInterruption: "blocked",
        },
      ],
      probeProfileId: "probe_1",
      issuedAt: timestamp,
      expiresAt: "2026-07-28T12:05:00.000Z",
      nonce: "nonce-1",
    };
    expect(dynamicControlPlanPayloadSchema.parse(payload)).toEqual(payload);
    expect(
      signedDynamicControlPlanSchema.parse({
        payload,
        payloadDigest: digest,
        signatureAlgorithm: "Ed25519",
        signingKeyId: "release-key-1",
        signature: "fixture-signature",
      }),
    ).toBeTruthy();
    expect(() =>
      dynamicControlPlanPayloadSchema.parse({
        ...payload,
        controls: [{ ...payload.controls[0], method: "DELETE" }],
      }),
    ).toThrow();
    expect(() =>
      dynamicControlPlanPayloadSchema.parse({ ...payload, genericCommand: "curl" }),
    ).toThrow();
    expect(() =>
      dynamicControlPlanPayloadSchema.parse({
        ...payload,
        internalOrigins: [{ scheme: "http", host: "service", port: 80 }],
        controls: [
          {
            ...payload.controls[0],
            safetyClass: "P0-passive",
            method: "POST",
            routeTemplate: "/../../admin",
            internalOrigin: { scheme: "http", host: "other-service", port: 80 },
            expectedSideEffects: ["delete records"],
          },
        ],
      }),
    ).toThrow();
  });
});
