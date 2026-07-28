import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import type {
  Approval,
  CapabilityResult,
  DomainCoverage,
  EvidenceOccurrence,
  Finding,
  PackageView,
  PackageValidationCertificate,
  PhaseDocument,
  ProductClaim,
  RunDocument,
  RunEvent,
  TargetSnapshot,
} from "@rak/contracts";
import { packageValidationCertificateSchema, targetSnapshotSchema } from "@rak/contracts";

export const sqlitePragmas = Object.freeze([
  "PRAGMA journal_mode=WAL",
  "PRAGMA foreign_keys=ON",
  "PRAGMA busy_timeout=5000",
  "PRAGMA synchronous=FULL",
]);

export interface SourceHandleView {
  sourceHandleId: string;
  kind: "local" | "ssh";
  displayName: string;
  allowedRootFingerprint: `sha256:${string}`;
  registeredAt: string;
}
export interface StoredRun {
  run: RunDocument;
  engagementId: string;
  source: unknown;
  selectedProfiles: string[];
  optionalServiceIds: string[];
}
export interface IdempotentResponse {
  status: number;
  body: unknown;
}
export interface PhaseAttemptRecord {
  attemptId: string;
  runId: string;
  phaseId: string;
  attemptNumber: number;
  state: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  inputDigest: string;
  fenceToken: number;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  createdAt: string;
  endedAt?: string;
}

function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

export function requestDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableJson(value)).digest("hex")}`;
}

export class IdempotencyConflict extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";
}

export class RakStore {
  readonly database: Database.Database;
  private readonly filename: string;

  constructor(filename = ":memory:") {
    this.filename = filename;
    this.database = new Database(filename);
    for (const pragma of sqlitePragmas) this.database.exec(pragma);
    this.applyVerifiedMigrations();
  }

  private applyVerifiedMigrations(): void {
    const migrationsDirectory = fileURLToPath(new URL("../migrations/", import.meta.url));
    const migrations = readdirSync(migrationsDirectory)
      .filter((name) => /^[0-9]{4}_[a-z0-9_]+\.sql$/.test(name))
      .sort()
      .map((name) => {
        const sql = readFileSync(`${migrationsDirectory}/${name}`, "utf8");
        return {
          name,
          sql,
          digest: `sha256:${createHash("sha256").update(sql).digest("hex")}`,
        };
      });
    if (migrations.length === 0) throw new Error("MIGRATION_CHAIN_EMPTY");

    if (this.filename !== ":memory:") {
      this.database.pragma("wal_checkpoint(FULL)");
    }
    this.database.exec("BEGIN EXCLUSIVE");
    let backup:
      | { id: string; digest: string; path: string; createdAt: string; verifiedAt: string }
      | undefined;
    try {
      const tables = this.database
        .prepare(
          `SELECT name FROM sqlite_master
           WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .pluck()
        .all() as string[];
      const hasMetadata = tables.includes("migration_metadata");
      if (!hasMetadata && tables.length > 0) throw new Error("MIGRATION_STATE_UNKNOWN");

      const applied = hasMetadata
        ? (this.database
            .prepare(
              `SELECT key,value FROM migration_metadata
               WHERE key LIKE 'migration:%' ORDER BY key`,
            )
            .all() as Array<{ key: string; value: string }>)
        : [];
      for (let index = 0; index < applied.length; index += 1) {
        const expected = migrations[index];
        const actual = applied[index];
        if (
          !expected ||
          actual?.key !== `migration:${expected.name}` ||
          actual.value !== expected.digest
        ) {
          throw new Error("MIGRATION_CHAIN_MISMATCH");
        }
      }
      const userVersion = Number(this.database.pragma("user_version", { simple: true }));
      if (userVersion !== applied.length || applied.length > migrations.length) {
        throw new Error("MIGRATION_VERSION_MISMATCH");
      }

      if (
        applied.length < migrations.length &&
        applied.length > 0 &&
        this.filename !== ":memory:" &&
        statSync(this.filename).size > 0
      ) {
        const createdAt = new Date().toISOString();
        const path = `${this.filename}.pre-migration-v${applied.length}-${Date.now()}.bak`;
        copyFileSync(this.filename, path);
        const verification = new Database(path, { readonly: true });
        const valid = verification.prepare("PRAGMA integrity_check").pluck().get() === "ok";
        verification.close();
        if (!valid) throw new Error("BACKUP_INTEGRITY_FAILED");
        backup = {
          id: `startup-${Date.now()}`,
          digest: `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`,
          path,
          createdAt,
          verifiedAt: createdAt,
        };
      }

      for (let index = applied.length; index < migrations.length; index += 1) {
        const migration = migrations[index]!;
        for (const statement of migration.sql.split("--> statement-breakpoint")) {
          if (statement.trim()) this.database.exec(statement);
        }
        this.database
          .prepare("INSERT INTO migration_metadata(key,value) VALUES(?,?)")
          .run(`migration:${migration.name}`, migration.digest);
        this.database.pragma(`user_version = ${index + 1}`);
      }
      const chainDigest = `sha256:${createHash("sha256")
        .update(migrations.map((migration) => `${migration.name}:${migration.digest}`).join("\n"))
        .digest("hex")}`;
      this.database
        .prepare(
          `INSERT INTO migration_metadata(key,value) VALUES('schema_version',?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        )
        .run(String(migrations.length));
      this.database
        .prepare(
          `INSERT INTO migration_metadata(key,value) VALUES('chain_digest',?)
           ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
        )
        .run(chainDigest);
      if (backup) {
        this.database
          .prepare(
            `INSERT INTO db_backups(id,digest,path,created_at,verified_at) VALUES(?,?,?,?,?)`,
          )
          .run(backup.id, backup.digest, backup.path, backup.createdAt, backup.verifiedAt);
      }
      this.database.exec("COMMIT");
    } catch (error) {
      if (this.database.inTransaction) this.database.exec("ROLLBACK");
      throw error;
    }
    if (this.database.prepare("PRAGMA integrity_check").pluck().get() !== "ok") {
      throw new Error("DATABASE_INTEGRITY_FAILED");
    }
  }

  close(): void {
    this.database.close();
  }

  checkIntegrity(): boolean {
    const result = this.database.prepare("PRAGMA quick_check").pluck().get();
    return result === "ok";
  }

  atomic<T>(operation: () => T): T {
    return this.database.transaction(operation)();
  }

  addSourceHandle(handle: SourceHandleView, internalRoot?: string): void {
    this.database
      .prepare(
        `INSERT INTO source_handles
         (id,kind,display_name,allowed_root_fingerprint,registered_at,internal_root)
         VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET
         display_name=excluded.display_name, allowed_root_fingerprint=excluded.allowed_root_fingerprint,
         internal_root=excluded.internal_root`,
      )
      .run(
        handle.sourceHandleId,
        handle.kind,
        handle.displayName,
        handle.allowedRootFingerprint,
        handle.registeredAt,
        internalRoot ?? null,
      );
  }

  getSourceHandleRoot(sourceHandleId: string): string | undefined {
    const root = this.database
      .prepare("SELECT internal_root FROM source_handles WHERE id=? AND kind='local'")
      .pluck()
      .get(sourceHandleId);
    return typeof root === "string" ? root : undefined;
  }

  listSourceHandles(): SourceHandleView[] {
    return this.database
      .prepare(
        `SELECT id AS sourceHandleId,kind,display_name AS displayName,
         allowed_root_fingerprint AS allowedRootFingerprint,registered_at AS registeredAt
         FROM source_handles ORDER BY id`,
      )
      .all() as SourceHandleView[];
  }

  createRun(record: StoredRun, phases: PhaseDocument[], event: RunEvent): void {
    this.database.transaction(() => {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO engagements(id,slug,retention_policy,created_at)
           VALUES(?,?,?,?)`,
        )
        .run(record.engagementId, record.engagementId, "default", record.run.createdAt);
      this.database
        .prepare(
          `INSERT INTO runs(id,engagement_id,parent_run_id,project_slug,revision,state,row_version,
           provider,source_json,selected_profiles_json,optional_service_ids_json,document_json,
           created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          record.run.runId,
          record.engagementId,
          record.run.parentRunId ?? null,
          record.run.projectSlug,
          record.run.revision,
          record.run.state,
          record.run.rowVersion,
          record.run.provider,
          JSON.stringify(record.source),
          JSON.stringify(record.selectedProfiles),
          JSON.stringify(record.optionalServiceIds),
          JSON.stringify(record.run),
          record.run.createdAt,
          record.run.updatedAt,
        );
      const insertPhase = this.database.prepare(
        `INSERT INTO phases(id,run_id,phase_key,revision,state,document_json) VALUES(?,?,?,?,?,?)`,
      );
      for (const phase of phases)
        insertPhase.run(
          phase.phaseId,
          record.run.runId,
          phase.phaseKey,
          phase.phaseRevision,
          phase.state,
          JSON.stringify(phase),
        );
      this.insertEvent(event);
    })();
  }

  getRun(runId: string): StoredRun | undefined {
    const row = this.database.prepare("SELECT * FROM runs WHERE id=?").get(runId) as
      | Record<string, unknown>
      | undefined;
    if (!row) return undefined;
    return {
      run: JSON.parse(String(row["document_json"])) as RunDocument,
      engagementId: String(row["engagement_id"]),
      source: JSON.parse(String(row["source_json"])) as unknown,
      selectedProfiles: JSON.parse(String(row["selected_profiles_json"])) as string[],
      optionalServiceIds: JSON.parse(String(row["optional_service_ids_json"])) as string[],
    };
  }

  listRuns(state?: string, limit = 50, offset = 0): RunDocument[] {
    const rows = state
      ? this.database
          .prepare(
            "SELECT document_json FROM runs WHERE state=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
          )
          .all(state, limit, offset)
      : this.database
          .prepare("SELECT document_json FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?")
          .all(limit, offset);
    return (rows as Array<{ document_json: string }>).map(
      (row) => JSON.parse(row.document_json) as RunDocument,
    );
  }

  getPhases(runId: string): PhaseDocument[] {
    const rows = this.database
      .prepare("SELECT document_json FROM phases WHERE run_id=? ORDER BY rowid")
      .all(runId) as Array<{ document_json: string }>;
    return rows.map((row) => JSON.parse(row.document_json) as PhaseDocument);
  }

  updateRun(run: RunDocument, event: RunEvent): void {
    this.database.transaction(() => {
      const previous = this.getRun(run.runId)?.run;
      if (previous && ["COMPLETED", "CANCELLED", "FAILED"].includes(previous.state)) {
        const previousStable = { ...previous, rowVersion: 0, updatedAt: "" };
        const nextStable = { ...run, rowVersion: 0, updatedAt: "" };
        if (stableJson(previousStable) !== stableJson(nextStable)) {
          throw new Error("RUN_TERMINAL_IMMUTABLE");
        }
      }
      const result = this.database
        .prepare(
          `UPDATE runs SET state=?,row_version=?,document_json=?,updated_at=?
           WHERE id=? AND row_version=?`,
        )
        .run(
          run.state,
          run.rowVersion,
          JSON.stringify(run),
          run.updatedAt,
          run.runId,
          run.rowVersion - 1,
        );
      if (result.changes !== 1) throw new Error("ROW_VERSION_MISMATCH");
      this.insertEvent(event);
    })();
  }

  private insertEvent(event: RunEvent): void {
    this.database
      .prepare(
        `INSERT INTO run_events(run_id,sequence,row_version,type,public_payload_json,occurred_at)
         VALUES(?,?,?,?,?,?)`,
      )
      .run(
        event.runId,
        Number(event.sequence),
        event.rowVersion,
        event.type,
        JSON.stringify(event),
        event.occurredAt,
      );
  }

  nextSequence(runId: string): string {
    const value = this.database
      .prepare("SELECT COALESCE(MAX(sequence),0)+1 FROM run_events WHERE run_id=?")
      .pluck()
      .get(runId);
    return String(value);
  }

  listEvents(runId: string, after = 0): RunEvent[] {
    const rows = this.database
      .prepare(
        "SELECT public_payload_json FROM run_events WHERE run_id=? AND sequence>? ORDER BY sequence",
      )
      .all(runId, after) as Array<{ public_payload_json: string }>;
    return rows.map((row) => JSON.parse(row.public_payload_json) as RunEvent);
  }

  admitSnapshot(runId: string, snapshotInput: TargetSnapshot, occurredAt: string): RunDocument {
    const snapshot = targetSnapshotSchema.parse(snapshotInput);
    const record = this.getRun(runId);
    if (!record) throw new Error("NOT_FOUND");
    if (record.run.state !== "RESOLVING_TARGET") throw new Error("RUN_STATE_CONFLICT");
    return this.atomic(() => {
      this.database
        .prepare(
          `INSERT INTO snapshots(id,run_id,manifest_digest,archive_digest,before_source_digest,
           after_source_digest,document_json,created_at) VALUES(?,?,?,?,?,?,?,?)`,
        )
        .run(
          snapshot.snapshotId,
          runId,
          snapshot.manifestDigest,
          snapshot.archiveDigest,
          snapshot.beforeSourceDigest,
          snapshot.afterSourceDigest,
          JSON.stringify(snapshot),
          snapshot.createdAt,
        );
      const updated: RunDocument = {
        ...record.run,
        targetSnapshotId: snapshot.snapshotId,
        state: "READY",
        rowVersion: record.run.rowVersion + 1,
        updatedAt: occurredAt,
      };
      const phases = this.getPhases(runId);
      const updatePhase = this.database.prepare(
        "UPDATE phases SET state=?,document_json=? WHERE id=?",
      );
      for (const phase of phases) {
        const state =
          phase.phaseKey === "discovery" || phase.phaseKey === "target-snapshot"
            ? "SUCCEEDED"
            : phase.phaseKey === "static-inventory"
              ? "READY"
              : phase.state;
        updatePhase.run(state, JSON.stringify({ ...phase, state }), phase.phaseId);
      }
      this.updateRun(updated, {
        schemaVersion: "1.0.0",
        sequence: this.nextSequence(runId),
        runId,
        rowVersion: updated.rowVersion,
        type: "run.state.changed",
        occurredAt,
        summary: "Immutable target snapshot admitted; assessment is ready",
      });
      return updated;
    });
  }

  getSnapshot(runId: string): TargetSnapshot | undefined {
    const row = this.database
      .prepare(
        "SELECT document_json FROM snapshots WHERE run_id=? ORDER BY created_at DESC LIMIT 1",
      )
      .get(runId) as { document_json: string } | undefined;
    return row ? (JSON.parse(row.document_json) as TargetSnapshot) : undefined;
  }

  recordLimitation(input: {
    limitationId: string;
    runId: string;
    domain: string;
    code: string;
    reason: string;
    effect: string;
    followUp: string;
    createdAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO limitations(id,run_id,domain,code,reason,effect,follow_up,created_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.limitationId,
        input.runId,
        input.domain,
        input.code,
        input.reason,
        input.effect,
        input.followUp,
        input.createdAt,
      );
  }

  surfaceLimitation(runId: string, limitationId: string, occurredAt: string): RunDocument {
    const record = this.getRun(runId);
    if (!record) throw new Error("NOT_FOUND");
    if (record.run.limitationIds.includes(limitationId)) return record.run;
    const updated: RunDocument = {
      ...record.run,
      limitationIds: [...record.run.limitationIds, limitationId],
      rowVersion: record.run.rowVersion + 1,
      updatedAt: occurredAt,
    };
    this.updateRun(updated, {
      schemaVersion: "1.0.0",
      sequence: this.nextSequence(runId),
      runId,
      rowVersion: updated.rowVersion,
      type: "warning.raised",
      occurredAt,
      summary: `Limitation recorded: ${limitationId}`,
    });
    return updated;
  }

  queueAttempt(input: PhaseAttemptRecord): void {
    this.database
      .prepare(
        `INSERT INTO phase_attempts(id,run_id,phase_id,attempt_number,state,input_digest,
         fence_token,lease_owner,lease_expires_at,created_at,ended_at)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .run(
        input.attemptId,
        input.runId,
        input.phaseId,
        input.attemptNumber,
        input.state,
        input.inputDigest,
        input.fenceToken,
        input.leaseOwner ?? null,
        input.leaseExpiresAt ?? null,
        input.createdAt,
        input.endedAt ?? null,
      );
  }

  listAttempts(runId: string): PhaseAttemptRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id AS attemptId,run_id AS runId,phase_id AS phaseId,
         attempt_number AS attemptNumber,state,input_digest AS inputDigest,
         fence_token AS fenceToken,lease_owner AS leaseOwner,
         lease_expires_at AS leaseExpiresAt,created_at AS createdAt,ended_at AS endedAt
         FROM phase_attempts WHERE run_id=? ORDER BY created_at,id`,
      )
      .all(runId) as PhaseAttemptRecord[];
    return rows;
  }

  queueCleanup(input: {
    cleanupId: string;
    runId: string;
    reason: string;
    createdAt: string;
  }): void {
    this.atomic(() => {
      this.database
        .prepare(
          `UPDATE phase_attempts SET fence_token=fence_token+1,state='CANCELLED',ended_at=?
           WHERE run_id=? AND state IN ('QUEUED','RUNNING')`,
        )
        .run(input.createdAt, input.runId);
      const fence = Number(
        this.database
          .prepare("SELECT COALESCE(MAX(fence_token),0) FROM phase_attempts WHERE run_id=?")
          .pluck()
          .get(input.runId),
      );
      this.database
        .prepare(
          `INSERT INTO cleanup_records(id,run_id,state,reason,fence_token,residues_json,created_at)
           VALUES(?,?,'COMPLETE',?,?,?,?)`,
        )
        .run(input.cleanupId, input.runId, input.reason, fence, "[]", input.createdAt);
      const record = this.getRun(input.runId);
      if (record?.run.state === "CANCELLING") {
        const cancelled: RunDocument = {
          ...record.run,
          state: "CANCELLED",
          rowVersion: record.run.rowVersion + 1,
          updatedAt: input.createdAt,
          terminalAt: input.createdAt,
        };
        this.updateRun(cancelled, {
          schemaVersion: "1.0.0",
          sequence: this.nextSequence(input.runId),
          runId: input.runId,
          rowVersion: cancelled.rowVersion,
          type: "run.state.changed",
          occurredAt: input.createdAt,
          summary: "Cancellation cleanup completed with no residues",
        });
      }
    });
  }

  putObjects<T extends { runId: string }>(
    runId: string,
    kind: string,
    objects: T[],
    idOf: (object: T) => string,
  ): void {
    this.database.transaction(() => {
      this.database
        .prepare("UPDATE run_objects SET current=0 WHERE run_id=? AND kind=?")
        .run(runId, kind);
      const insert = this.database.prepare(
        `INSERT INTO run_objects(run_id,kind,object_id,revision,current,document_json)
         VALUES(?,?,?,?,1,?)`,
      );
      for (const object of objects) {
        const previous = this.database
          .prepare(
            "SELECT COALESCE(MAX(revision),0) FROM run_objects WHERE run_id=? AND kind=? AND object_id=?",
          )
          .pluck()
          .get(runId, kind, idOf(object));
        insert.run(runId, kind, idOf(object), Number(previous) + 1, JSON.stringify(object));
      }
    })();
  }

  listObjects<T>(runId: string, kind: string): T[] {
    const rows = this.database
      .prepare(
        "SELECT document_json FROM run_objects WHERE run_id=? AND kind=? AND current=1 ORDER BY object_id",
      )
      .all(runId, kind) as Array<{ document_json: string }>;
    return rows.map((row) => JSON.parse(row.document_json) as T);
  }

  getObject<T>(runId: string, kind: string, objectId: string): T | undefined {
    const row = this.database
      .prepare(
        `SELECT document_json FROM run_objects
         WHERE run_id=? AND kind=? AND object_id=? AND current=1`,
      )
      .get(runId, kind, objectId) as { document_json: string } | undefined;
    return row ? (JSON.parse(row.document_json) as T) : undefined;
  }

  listClaims(runId: string): ProductClaim[] {
    return this.listObjects<ProductClaim>(runId, "claim");
  }
  listApprovals(runId: string): Approval[] {
    return this.listObjects<Approval>(runId, "approval");
  }
  listCapabilities(runId: string): CapabilityResult[] {
    return this.listObjects<CapabilityResult>(runId, "capability");
  }
  listCoverage(runId: string): DomainCoverage[] {
    return this.listObjects<DomainCoverage>(runId, "coverage");
  }
  listFindings(runId: string): Finding[] {
    return this.listObjects<Finding>(runId, "finding");
  }
  listEvidence(runId: string): EvidenceOccurrence[] {
    return this.listObjects<EvidenceOccurrence>(runId, "evidence");
  }
  listPackages(runId: string): PackageView[] {
    return this.listObjects<PackageView & { runId: string }>(runId, "package");
  }

  createSecretMetadata(input: {
    secretHandleId: string;
    runId: string;
    purpose: string;
    recipient: string;
    approvalId?: string;
    expiresAt: string;
    createdAt: string;
  }): void {
    this.database
      .prepare(
        `INSERT INTO secret_handles
         (id,run_id,purpose,recipient,approval_id,expires_at,state,created_at)
         VALUES(?,?,?,?,?,?,'AWAITING_UPLOAD',?)`,
      )
      .run(
        input.secretHandleId,
        input.runId,
        input.purpose,
        input.recipient,
        input.approvalId ?? null,
        input.expiresAt,
        input.createdAt,
      );
  }

  setSecretState(secretHandleId: string, state: "UPLOADED" | "REVOKED", at: string): void {
    const result = this.database
      .prepare(
        `UPDATE secret_handles SET state=?,revoked_at=CASE WHEN ?='REVOKED' THEN ? ELSE revoked_at END
         WHERE id=? AND state!='REVOKED'`,
      )
      .run(state, state, at, secretHandleId);
    if (result.changes !== 1) throw new Error("NOT_FOUND");
  }

  revokeRunSecrets(runId: string, at: string): string[] {
    const rows = this.database
      .prepare("SELECT id FROM secret_handles WHERE run_id=? AND state!='REVOKED' ORDER BY id")
      .all(runId) as Array<{ id: string }>;
    this.database
      .prepare(
        `UPDATE secret_handles SET state='REVOKED',revoked_at=?
         WHERE run_id=? AND state!='REVOKED'`,
      )
      .run(at, runId);
    return rows.map((row) => row.id);
  }

  putReview(
    runId: string,
    review: {
      reviewId: string;
      kind: string;
      inputDigest: string;
      verdict: string;
      completedAt: string;
    },
  ): void {
    this.atomic(() => {
      this.database
        .prepare(
          `INSERT INTO reviews(id,run_id,kind,input_digest,verdict,document_json,completed_at)
           VALUES(?,?,?,?,?,?,?)`,
        )
        .run(
          review.reviewId,
          runId,
          review.kind,
          review.inputDigest,
          review.verdict,
          JSON.stringify(review),
          review.completedAt,
        );
      this.putObjects(runId, "review", [{ ...review, runId }], (item) => item.reviewId);
    });
  }

  putDeletionJob(
    runId: string,
    job: {
      deletionJobId: string;
      scope: string;
      state: string;
      trashPathDigest?: string;
      trashedAt?: string;
      purgeAfter?: string;
    },
  ): void {
    this.database
      .prepare(
        `INSERT INTO deletion_jobs(id,run_id,scope,state,trash_path_digest,trash_at,purge_after,document_json)
         VALUES(?,?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET state=excluded.state,document_json=excluded.document_json`,
      )
      .run(
        job.deletionJobId,
        runId,
        job.scope,
        job.state,
        job.trashPathDigest ?? null,
        job.trashedAt ?? null,
        job.purgeAfter ?? null,
        JSON.stringify(job),
      );
  }

  getDeletionJob<T>(runId: string, deletionJobId: string): T | undefined {
    const row = this.database
      .prepare("SELECT document_json FROM deletion_jobs WHERE run_id=? AND id=?")
      .get(runId, deletionJobId) as { document_json: string } | undefined;
    return row ? (JSON.parse(row.document_json) as T) : undefined;
  }

  admitPackageValidation(
    certificateInput: PackageValidationCertificate,
    artifactAbsolutePath: string,
  ): PackageView {
    const certificate = packageValidationCertificateSchema.parse(certificateInput);
    const { certificateDigest, ...certificatePayload } = certificate;
    if (requestDigest(certificatePayload) !== certificateDigest) {
      throw new Error("PACKAGE_VALIDATION_FAILED");
    }
    const record = this.getRun(certificate.runId);
    if (
      !record ||
      record.run.state !== "PACKAGING" ||
      record.run.revision !== certificate.runRevision
    ) {
      throw new Error("PACKAGE_VALIDATION_FAILED");
    }
    const bytes = readFileSync(artifactAbsolutePath);
    if (
      `sha256:${createHash("sha256").update(bytes).digest("hex")}` !== certificate.packageDigest ||
      String(bytes.byteLength) !== certificate.byteLength
    ) {
      throw new Error("PACKAGE_VALIDATION_FAILED");
    }
    const view: PackageView & { runId: string } = {
      packageId: certificate.packageId,
      runId: certificate.runId,
      revision: certificate.runRevision,
      state: "VALIDATED",
      zipByteLength: certificate.byteLength,
      zipSha256: certificate.packageDigest,
      validationReportId: certificate.validationReportId,
    };
    this.atomic(() => {
      this.database
        .prepare(
          `INSERT INTO package_validations
           (package_id,run_id,run_revision,package_digest,validation_report_id,
            certificate_digest,artifact_path,byte_length,admitted_at)
           VALUES(?,?,?,?,?,?,?,?,?)`,
        )
        .run(
          certificate.packageId,
          certificate.runId,
          certificate.runRevision,
          certificate.packageDigest,
          certificate.validationReportId,
          certificate.certificateDigest,
          artifactAbsolutePath,
          certificate.byteLength,
          certificate.validatedAt,
        );
      this.putObjects(certificate.runId, "package", [view], (item) => item.packageId);
      const completed: RunDocument = {
        ...record.run,
        state: "COMPLETED",
        packageId: certificate.packageId,
        rowVersion: record.run.rowVersion + 1,
        updatedAt: certificate.validatedAt,
        terminalAt: certificate.validatedAt,
      };
      this.updateRun(completed, {
        schemaVersion: "1.0.0",
        sequence: this.nextSequence(certificate.runId),
        runId: certificate.runId,
        rowVersion: completed.rowVersion,
        type: "package.state.changed",
        occurredAt: certificate.validatedAt,
        summary: "Validated package admitted and bound to the run revision",
      });
    });
    return view;
  }

  getValidatedPackage(
    runId: string,
    packageId: string,
  ): { view: PackageView; artifactPath: string } | undefined {
    const row = this.database
      .prepare(
        `SELECT artifact_path AS artifactPath FROM package_validations
         WHERE run_id=? AND package_id=?`,
      )
      .get(runId, packageId) as { artifactPath: string } | undefined;
    const view = this.getObject<PackageView>(runId, "package", packageId);
    return row && view?.state === "VALIDATED"
      ? { view, artifactPath: row.artifactPath }
      : undefined;
  }

  async backupTo(input: { backupId: string; path: string; createdAt: string }): Promise<string> {
    mkdirSync(dirname(input.path), { recursive: true, mode: 0o700 });
    const temporary = `${input.path}.tmp`;
    await this.database.backup(temporary);
    const verification = new Database(temporary, { readonly: true });
    const valid = verification.prepare("PRAGMA integrity_check").pluck().get() === "ok";
    verification.close();
    if (!valid) throw new Error("BACKUP_INTEGRITY_FAILED");
    const digest = `sha256:${createHash("sha256").update(readFileSync(temporary)).digest("hex")}`;
    renameSync(temporary, input.path);
    this.database
      .prepare(`INSERT INTO db_backups(id,digest,path,created_at,verified_at) VALUES(?,?,?,?,?)`)
      .run(input.backupId, digest, input.path, input.createdAt, input.createdAt);
    return digest;
  }

  replayIdempotent(
    principal: string,
    operation: string,
    runId: string,
    key: string,
    request: unknown,
  ): IdempotentResponse | undefined {
    const row = this.database
      .prepare(
        `SELECT request_digest,status,response_json,expires_at FROM idempotency_keys
         WHERE principal=? AND operation=? AND run_id=? AND key=?`,
      )
      .get(principal, operation, runId, key) as
      | { request_digest: string; status: number; response_json: string; expires_at: string }
      | undefined;
    if (!row) return undefined;
    if (Date.parse(row.expires_at) <= Date.now()) {
      this.database
        .prepare(
          "DELETE FROM idempotency_keys WHERE principal=? AND operation=? AND run_id=? AND key=?",
        )
        .run(principal, operation, runId, key);
      return undefined;
    }
    if (row.request_digest !== requestDigest(request)) throw new IdempotencyConflict();
    return { status: row.status, body: JSON.parse(row.response_json) as unknown };
  }

  saveIdempotent(
    principal: string,
    operation: string,
    runId: string,
    key: string,
    request: unknown,
    response: IdempotentResponse,
    expiresAt: string,
  ): void {
    this.database
      .prepare(
        `INSERT INTO idempotency_keys
         (principal,operation,run_id,key,request_digest,status,response_json,expires_at)
         VALUES(?,?,?,?,?,?,?,?)`,
      )
      .run(
        principal,
        operation,
        runId,
        key,
        requestDigest(request),
        response.status,
        JSON.stringify(response.body),
        expiresAt,
      );
  }
}
