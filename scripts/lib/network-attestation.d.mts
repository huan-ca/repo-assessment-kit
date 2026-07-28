export const providerEndpoints: Readonly<
  Record<string, ReadonlyArray<Readonly<{ host: string; port: number }>>>
>;
export function canonicalJson(value: unknown): string;
export function verifyNetworkAttestation(
  envelope: unknown,
  publicKey: KeyLike,
  expected: {
    kind: string;
    subject: string;
    network: string;
    networkId: string;
    nonce: string;
    installationRoot: string;
    now?: number;
  },
): unknown;
import type { KeyLike } from "node:crypto";
