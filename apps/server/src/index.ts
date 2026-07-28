import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { RakStore } from "@rak/persistence";
import { createApp } from "./app.js";
import { createLocalSnapshotResolver } from "./local-acquisition.js";

const store = new RakStore(process.env["RAK_DATABASE_PATH"] ?? ":memory:");
const localSourceRoot = process.env["RAK_LOCAL_SOURCE_ROOT"];
let snapshotResolver;
if (localSourceRoot) {
  const root = realpathSync(localSourceRoot);
  store.addSourceHandle(
    {
      sourceHandleId: process.env["RAK_LOCAL_SOURCE_HANDLE_ID"] ?? "src_local",
      kind: "local",
      displayName: process.env["RAK_LOCAL_SOURCE_DISPLAY_NAME"] ?? "Registered local source",
      allowedRootFingerprint: `sha256:${createHash("sha256").update(root).digest("hex")}`,
      registeredAt: new Date().toISOString(),
    },
    root,
  );
  snapshotResolver = createLocalSnapshotResolver({
    store,
    snapshotRoot: resolve(process.env["RAK_SNAPSHOT_ROOT"] ?? "state/snapshots"),
  });
}
if (process.env["RAK_SSH_SOURCE_HANDLE_ID"]) {
  store.addSourceHandle({
    sourceHandleId: process.env["RAK_SSH_SOURCE_HANDLE_ID"],
    kind: "ssh",
    displayName: "Registered SSH acquisition handle",
    allowedRootFingerprint: `sha256:${createHash("sha256")
      .update(process.env["RAK_SSH_SOURCE_HANDLE_ID"])
      .digest("hex")}`,
    registeredAt: new Date().toISOString(),
  });
}
const port = Number.parseInt(process.env["RAK_INTERNAL_PORT"] ?? "3000", 10);
const app = createApp({
  store,
  publicOrigin:
    process.env["RAK_PUBLIC_ORIGIN"] ??
    `http://127.0.0.1:${process.env["RAK_PUBLIC_PORT"] ?? "4173"}`,
  ...(snapshotResolver ? { snapshotResolver } : {}),
});

try {
  await app.listen({ host: "127.0.0.1", port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
