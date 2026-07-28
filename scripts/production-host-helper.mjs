#!/usr/bin/env node
import { pathToFileURL } from "node:url";

import { createHostHelperService } from "./host-helper-service.mjs";

function usage() {
  throw new Error(
    "usage: production-host-helper.mjs serve | reconcile | emergency-stop --run-id <id> --runtime-id <id>",
  );
}

export function parseHostHelperCli(argv) {
  if (argv.length === 1 && ["serve", "reconcile"].includes(argv[0])) return { verb: argv[0] };
  if (
    argv.length === 5 &&
    argv[0] === "emergency-stop" &&
    argv[1] === "--run-id" &&
    argv[3] === "--runtime-id" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(argv[2]) &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(argv[4])
  ) {
    return { verb: argv[0], runId: argv[2], runtimeId: argv[4] };
  }
  return usage();
}

async function main() {
  const command = parseHostHelperCli(process.argv.slice(2));
  const service = await createHostHelperService();
  if (command.verb === "serve") {
    await service.listen();
    return;
  }
  const result =
    command.verb === "reconcile"
      ? await service.reconcile()
      : await service.emergencyStop(command.runId, command.runtimeId);
  process.stdout.write(
    `${JSON.stringify({
      schemaVersion: "rak-host-helper-maintenance/1.0.0",
      operation: command.verb,
      runId: command.runId,
      runtimeId: command.runtimeId,
      status: result.state,
      cleanup: result.cleanup,
    })}\n`,
  );
  process.exitCode = result.state === "SUCCEEDED" ? 0 : 78;
  await service.journal.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
