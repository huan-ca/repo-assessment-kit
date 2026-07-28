import { integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const engagements = sqliteTable(
  "engagements",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    retentionPolicy: text("retention_policy").notNull(),
    createdAt: text("created_at").notNull(),
    closedAt: text("closed_at"),
  },
  (table) => [uniqueIndex("engagements_slug_uq").on(table.slug)],
);

export const runs = sqliteTable(
  "runs",
  {
    id: text("id").primaryKey(),
    engagementId: text("engagement_id").notNull(),
    parentRunId: text("parent_run_id"),
    projectSlug: text("project_slug").notNull(),
    revision: integer("revision").notNull(),
    state: text("state").notNull(),
    rowVersion: integer("row_version").notNull(),
    provider: text("provider").notNull(),
    sourceJson: text("source_json").notNull(),
    selectedProfilesJson: text("selected_profiles_json").notNull(),
    optionalServiceIdsJson: text("optional_service_ids_json").notNull(),
    documentJson: text("document_json").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("runs_parent_revision_uq").on(table.parentRunId, table.revision),
    uniqueIndex("runs_project_revision_uq").on(
      table.engagementId,
      table.projectSlug,
      table.revision,
    ),
  ],
);

export const phases = sqliteTable(
  "phases",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    phaseKey: text("phase_key").notNull(),
    revision: integer("revision").notNull(),
    state: text("state").notNull(),
    documentJson: text("document_json").notNull(),
  },
  (table) => [
    uniqueIndex("phases_run_key_revision_uq").on(table.runId, table.phaseKey, table.revision),
  ],
);

export const runEvents = sqliteTable(
  "run_events",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    sequence: integer("sequence").notNull(),
    rowVersion: integer("row_version").notNull(),
    type: text("type").notNull(),
    publicPayloadJson: text("public_payload_json").notNull(),
    occurredAt: text("occurred_at").notNull(),
    published: integer("published", { mode: "boolean" }).notNull().default(false),
  },
  (table) => [primaryKey({ columns: [table.runId, table.sequence] })],
);

export const idempotencyKeys = sqliteTable(
  "idempotency_keys",
  {
    principal: text("principal").notNull(),
    operation: text("operation").notNull(),
    runId: text("run_id").notNull(),
    key: text("key").notNull(),
    requestDigest: text("request_digest").notNull(),
    status: integer("status").notNull(),
    responseJson: text("response_json").notNull(),
    expiresAt: text("expires_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.principal, table.operation, table.runId, table.key] })],
);

export const runObjects = sqliteTable(
  "run_objects",
  {
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    kind: text("kind").notNull(),
    objectId: text("object_id").notNull(),
    revision: integer("revision").notNull().default(1),
    current: integer("current", { mode: "boolean" }).notNull().default(true),
    documentJson: text("document_json").notNull(),
  },
  (table) => [primaryKey({ columns: [table.runId, table.kind, table.objectId, table.revision] })],
);

export const sourceHandles = sqliteTable("source_handles", {
  id: text("id").primaryKey(),
  kind: text("kind").notNull(),
  displayName: text("display_name").notNull(),
  allowedRootFingerprint: text("allowed_root_fingerprint").notNull(),
  registeredAt: text("registered_at").notNull(),
  internalRoot: text("internal_root"),
});

export const snapshots = sqliteTable(
  "snapshots",
  {
    id: text("id").notNull(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    manifestDigest: text("manifest_digest").notNull(),
    archiveDigest: text("archive_digest").notNull(),
    beforeSourceDigest: text("before_source_digest").notNull(),
    afterSourceDigest: text("after_source_digest").notNull(),
    documentJson: text("document_json").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.runId, table.id] }),
    uniqueIndex("snapshots_run_digest_uq").on(table.runId, table.manifestDigest),
  ],
);

export const phaseAttempts = sqliteTable(
  "phase_attempts",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id),
    phaseId: text("phase_id")
      .notNull()
      .references(() => phases.id),
    attemptNumber: integer("attempt_number").notNull(),
    state: text("state").notNull(),
    inputDigest: text("input_digest").notNull(),
    fenceToken: integer("fence_token").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: text("lease_expires_at"),
    createdAt: text("created_at").notNull(),
    endedAt: text("ended_at"),
  },
  (table) => [uniqueIndex("phase_attempts_number_uq").on(table.phaseId, table.attemptNumber)],
);

export const cleanupRecords = sqliteTable("cleanup_records", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  state: text("state").notNull(),
  reason: text("reason").notNull(),
  fenceToken: integer("fence_token").notNull(),
  residuesJson: text("residues_json").notNull(),
  createdAt: text("created_at").notNull(),
  completedAt: text("completed_at"),
});

export const limitations = sqliteTable("limitations", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  domain: text("domain").notNull(),
  code: text("code").notNull(),
  reason: text("reason").notNull(),
  effect: text("effect").notNull(),
  followUp: text("follow_up").notNull(),
  createdAt: text("created_at").notNull(),
});

export const secretHandles = sqliteTable("secret_handles", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  purpose: text("purpose").notNull(),
  recipient: text("recipient").notNull(),
  approvalId: text("approval_id"),
  expiresAt: text("expires_at").notNull(),
  state: text("state").notNull(),
  createdAt: text("created_at").notNull(),
  revokedAt: text("revoked_at"),
});

export const reviews = sqliteTable("reviews", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  kind: text("kind").notNull(),
  inputDigest: text("input_digest").notNull(),
  verdict: text("verdict").notNull(),
  documentJson: text("document_json").notNull(),
  completedAt: text("completed_at").notNull(),
});

export const deletionJobs = sqliteTable("deletion_jobs", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  scope: text("scope").notNull(),
  state: text("state").notNull(),
  trashPathDigest: text("trash_path_digest"),
  trashAt: text("trash_at"),
  purgeAfter: text("purge_after"),
  documentJson: text("document_json").notNull(),
});

export const packageValidations = sqliteTable("package_validations", {
  packageId: text("package_id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  runRevision: integer("run_revision").notNull(),
  packageDigest: text("package_digest").notNull(),
  validationReportId: text("validation_report_id").notNull(),
  certificateDigest: text("certificate_digest").notNull(),
  artifactPath: text("artifact_path").notNull(),
  byteLength: text("byte_length").notNull(),
  admittedAt: text("admitted_at").notNull(),
});

export const databaseBackups = sqliteTable("db_backups", {
  id: text("id").primaryKey(),
  digest: text("digest").notNull(),
  path: text("path").notNull(),
  createdAt: text("created_at").notNull(),
  verifiedAt: text("verified_at").notNull(),
});

export const migrationMetadata = sqliteTable("migration_metadata", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
