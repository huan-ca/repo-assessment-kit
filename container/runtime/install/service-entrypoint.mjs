#!/usr/local/libexec/repo-assessment-kit/node
import { lstat, unlink } from "node:fs/promises";

import { createHostHelperService } from "./scripts/host-helper-service.mjs";
import { HOST_HELPER_PATHS } from "./scripts/host-helper-protocol.mjs";
import { validateProductionHostHelperInstallation } from "./validate-production-host-helper.mjs";

await validateProductionHostHelperInstallation();
const service = await createHostHelperService();
const server = await service.listen();
const createdSocket = await lstat(HOST_HELPER_PATHS.socket);
let stopping = false;

async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  await service.journal.close();
  const current = await lstat(HOST_HELPER_PATHS.socket).catch((error) =>
    error?.code === "ENOENT" ? undefined : Promise.reject(error),
  );
  if (current !== undefined) {
    if (
      current.isSymbolicLink() ||
      !current.isSocket() ||
      current.dev !== createdSocket.dev ||
      current.ino !== createdSocket.ino ||
      current.uid !== createdSocket.uid ||
      (current.mode & 0o777) !== 0o600
    ) {
      throw new Error("refusing to remove a changed host-helper socket");
    }
    await unlink(HOST_HELPER_PATHS.socket);
  }
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    void stop().then(
      () => {
        process.exitCode = 0;
      },
      (error) => {
        process.stderr.write(
          `host-helper shutdown failed: ${error instanceof Error ? error.message : "unknown error"}\n`,
        );
        process.exitCode = 1;
      },
    );
  });
}
