import type {
  ProviderBrokerClient,
  ProviderBrokerJob,
  ProviderRunnerTransport,
  ProviderTaskEnvelope,
} from "./types.js";
import { providerCliSpecs } from "./provider-spec.js";

export type ProviderBrokerJobFactory = (
  envelope: ProviderTaskEnvelope,
) => ProviderBrokerJob | Promise<ProviderBrokerJob>;

function sameArguments(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Adapts the private, journal-authoritative release broker to the common provider transport.
 * The job factory is orchestrator-owned: adapters never mint attempts, fences, nonces,
 * admission digests, provider homes, or egress authority.
 */
export function createProviderBrokerTransport(input: {
  provider: "codex" | "claude-code";
  broker: ProviderBrokerClient;
  createJob: ProviderBrokerJobFactory;
}): ProviderRunnerTransport {
  return {
    get available() {
      return input.broker.available;
    },
    async execute(launch, signal) {
      const job = await input.createJob(launch.taskEnvelope);
      const specification = providerCliSpecs[input.provider];
      if (
        job.provider !== input.provider ||
        job.envelope.provider !== input.provider ||
        job.envelope.capsule.task.runId !== job.runId ||
        job.envelope.capsule.task.attemptId !== job.attemptId ||
        job.envelope.capsule.task.fenceToken !== job.fenceToken ||
        job.envelope.capsule.task.deadlineAt !== job.deadlineAt ||
        JSON.stringify(job.envelope) !== JSON.stringify(launch.taskEnvelope) ||
        launch.executable !== specification.executable ||
        !sameArguments(launch.fixedArguments, specification.fixedArguments)
      ) {
        throw new Error("PROVIDER_BROKER_JOB_INVALID");
      }
      return input.broker.execute(job, signal);
    },
  };
}
