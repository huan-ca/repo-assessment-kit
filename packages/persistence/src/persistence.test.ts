import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { phaseKeys, type PhaseDocument, type RunDocument, type RunEvent } from "@rak/contracts";
import { RakStore } from "./index.js";

describe("durable local persistence", () => {
  it("survives reopen, verifies backups, and enforces terminal immutability", async () => {
    const directory = mkdtempSync(join(tmpdir(), "rak-store-"));
    const filename = join(directory, "state.sqlite");
    const run: RunDocument = {
      schemaVersion: "1.0.0",
      runId: "run_fixture",
      projectSlug: "fixture",
      provider: "claude-code",
      revision: 1,
      rowVersion: 0,
      state: "DRAFT",
      workflowProfile: "rak-workflow/1.0.0",
      exportProfile: "rak-export-profile/1.0.0",
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z",
      limitationIds: [],
    };
    const event: RunEvent = {
      schemaVersion: "1.0.0",
      sequence: "1",
      runId: run.runId,
      rowVersion: 0,
      type: "run.state.changed",
      occurredAt: run.createdAt,
      summary: "created",
    };
    const first = new RakStore(filename);
    let counter = 0;
    first.createRun(
      {
        run,
        engagementId: "eng_fixture",
        source: { kind: "local" },
        selectedProfiles: [],
        optionalServiceIds: [],
      },
      phaseKeys.map(
        (phaseKey, index): PhaseDocument => ({
          schemaVersion: "1.0.0",
          phaseId: `phs_${++counter}`,
          runId: run.runId,
          phaseKey,
          phaseRevision: 1,
          state: index === 0 ? "READY" : "PENDING",
          required: phaseKey !== "dynamic-assessment",
          dependsOn: index === 0 ? [] : [phaseKeys[index - 1] as string],
          limitationIds: [],
        }),
      ),
      event,
    );
    first.close();
    const reopened = new RakStore(filename);
    expect(reopened.checkIntegrity()).toBe(true);
    expect(
      reopened.database
        .prepare("SELECT COUNT(*) FROM migration_metadata WHERE key LIKE 'migration:%'")
        .pluck()
        .get(),
    ).toBe(4);
    expect(reopened.database.pragma("user_version", { simple: true })).toBe(4);
    expect(
      reopened.database
        .prepare("SELECT value FROM migration_metadata WHERE key='chain_digest'")
        .pluck()
        .get(),
    ).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(reopened.getRun(run.runId)?.run).toEqual(run);
    expect(reopened.getPhases(run.runId)).toHaveLength(14);
    expect(reopened.listEvents(run.runId)).toEqual([event]);
    const backupPath = join(directory, "backups", "state.sqlite");
    const backupDigest = await reopened.backupTo({
      backupId: "bak_fixture",
      path: backupPath,
      createdAt: "2026-07-28T00:01:00.000Z",
    });
    expect(backupDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    const terminal = {
      ...run,
      state: "COMPLETED" as const,
      terminalAt: "2026-07-28T00:02:00.000Z",
    };
    reopened.database
      .prepare("UPDATE runs SET state=?,document_json=? WHERE id=?")
      .run("COMPLETED", JSON.stringify(terminal), run.runId);
    expect(() =>
      reopened.updateRun(
        { ...terminal, projectSlug: "changed", rowVersion: 1 },
        { ...event, sequence: "2", rowVersion: 1 },
      ),
    ).toThrow("RUN_TERMINAL_IMMUTABLE");
    reopened.database
      .prepare("UPDATE migration_metadata SET value=? WHERE key LIKE 'migration:%'")
      .run(`sha256:${"0".repeat(64)}`);
    reopened.close();
    expect(() => new RakStore(filename)).toThrow("MIGRATION_CHAIN_MISMATCH");
  });
});
