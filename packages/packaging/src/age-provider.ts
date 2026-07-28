import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { StrongEncryptionProvider } from "./index.js";

const execFileAsync = promisify(execFile);
const AGE_VERSION = "v1.3.1";
const X25519_RECIPIENT = /^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/u;
const TRUSTED_AGE_EXECUTABLES = Object.freeze({
  "linux/amd64": "2e305637f2a0555305e21c17fb74446acbb39b53135d43d4b744e50c287133a5",
  "linux/arm64": "92da3edf27811a65a599342d743a13bb50b7f0b07f8947530d4e83249f2e4532",
});

export interface AgeCliProviderOptions {
  ageBinary: string;
  recipient: string;
  identityFile: string;
  releaseAuthority: VerifiedAgeReleaseAuthority;
}

export interface VerifiedAgeReleaseAuthority {
  profile: "rak-verified-release/1.0.0";
  verified: true;
  toolchainLockSha256: string;
  tools: {
    age: {
      version: "1.3.1";
      platform: "linux/amd64" | "linux/arm64";
      executableSha256: string;
      stagedPath: string;
    };
  };
}

export interface AgeCliCapability {
  available: boolean;
  provider: "age-cli/1.3.1";
  mechanism: "age-v1";
  reason?: string;
}

async function requireProtectedRegularFile(filePath: string, label: string): Promise<void> {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} must be a regular file`);
  if (process.platform !== "win32" && (info.mode & 0o077) !== 0)
    throw new Error(`${label} must not be accessible by group or other users`);
}

function nativePlatform(): keyof typeof TRUSTED_AGE_EXECUTABLES | undefined {
  if (process.platform !== "linux") return undefined;
  if (process.arch === "x64") return "linux/amd64";
  if (process.arch === "arm64") return "linux/arm64";
  return undefined;
}

async function requireTrustedExecutable(
  filePath: string,
  authority: VerifiedAgeReleaseAuthority,
): Promise<void> {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("age executable must be a regular file");
  if (process.platform !== "win32" && (info.mode & 0o111) === 0)
    throw new Error("age executable is not executable");
  if (process.platform !== "win32" && (info.mode & 0o022) !== 0)
    throw new Error("age executable must not be group- or other-writable");
  const platform = nativePlatform();
  if (platform === undefined) throw new Error("age executable is unavailable on this platform");
  const expected = TRUSTED_AGE_EXECUTABLES[platform];
  const authorized = authority?.tools?.age;
  if (
    authority?.profile !== "rak-verified-release/1.0.0" ||
    authority.verified !== true ||
    !/^[a-f0-9]{64}$/u.test(authority.toolchainLockSha256) ||
    authorized?.version !== "1.3.1" ||
    authorized.platform !== platform ||
    authorized.executableSha256 !== expected ||
    (await realpath(authorized.stagedPath)) !== (await realpath(filePath))
  )
    throw new Error("age executable is not authorized by the verified signed toolchain");
  const actual = createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
  if (actual !== expected) throw new Error("age executable digest does not match the signed pin");
}

async function executeAge(ageBinary: string, args: string[]): Promise<void> {
  await execFileAsync(ageBinary, args, {
    encoding: "utf8",
    env: {
      PATH: "/usr/bin:/bin",
      HOME: "/nonexistent",
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
    },
    maxBuffer: 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
  });
}

export async function ageCliCapability(
  ageBinary: string | undefined,
  releaseAuthority?: VerifiedAgeReleaseAuthority,
): Promise<AgeCliCapability> {
  if (ageBinary === undefined || ageBinary.trim() === "")
    return {
      available: false,
      provider: "age-cli/1.3.1",
      mechanism: "age-v1",
      reason:
        "Strong encryption is unavailable: an exact trusted age v1.3.1 executable was not configured.",
    };
  try {
    if (releaseAuthority === undefined)
      throw new Error("verified signed release authority was not supplied");
    await requireTrustedExecutable(ageBinary, releaseAuthority);
    const { stdout } = await execFileAsync(ageBinary, ["--version"], {
      encoding: "utf8",
      env: { PATH: "/usr/bin:/bin", HOME: "/nonexistent", LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      maxBuffer: 64 * 1024,
      timeout: 10_000,
      windowsHide: true,
    });
    if (stdout.trim() !== AGE_VERSION)
      return {
        available: false,
        provider: "age-cli/1.3.1",
        mechanism: "age-v1",
        reason: `Strong encryption is unavailable: expected age ${AGE_VERSION}, received ${JSON.stringify(stdout.trim())}.`,
      };
    return { available: true, provider: "age-cli/1.3.1", mechanism: "age-v1" };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown executable error";
    return {
      available: false,
      provider: "age-cli/1.3.1",
      mechanism: "age-v1",
      reason: `Strong encryption is unavailable: age ${AGE_VERSION} could not be verified (${reason}).`,
    };
  }
}

export class AgeCliEncryptionProvider implements StrongEncryptionProvider {
  readonly name = "age-cli/1.3.1";
  readonly algorithm = "age-v1" as const;
  readonly trusted = true as const;

  constructor(private readonly options: AgeCliProviderOptions) {}

  async encryptAndVerify(plainZip: Uint8Array): Promise<{
    encrypted: Uint8Array;
    recoveredZipSha256: string;
  }> {
    const capability = await ageCliCapability(
      this.options.ageBinary,
      this.options.releaseAuthority,
    );
    if (!capability.available) throw new Error(capability.reason);
    if (!X25519_RECIPIENT.test(this.options.recipient))
      throw new Error("age recipient must be one canonical X25519 public recipient");
    await requireProtectedRegularFile(this.options.identityFile, "age identity file");

    const workingDirectory = await mkdtemp(join(tmpdir(), "rak-age-"));
    await chmod(workingDirectory, 0o700);
    const inputPath = join(workingDirectory, "customer-package.zip");
    const encryptedPath = join(workingDirectory, "customer-package.zip.age");
    const recoveredPath = join(workingDirectory, "recovered.zip");
    try {
      await writeFile(inputPath, plainZip, { flag: "wx", mode: 0o600 });
      await executeAge(this.options.ageBinary, [
        "--encrypt",
        "--recipient",
        this.options.recipient,
        "--output",
        encryptedPath,
        inputPath,
      ]);
      await executeAge(this.options.ageBinary, [
        "--decrypt",
        "--identity",
        this.options.identityFile,
        "--output",
        recoveredPath,
        encryptedPath,
      ]);
      const [encrypted, recovered] = await Promise.all([
        readFile(encryptedPath),
        readFile(recoveredPath),
      ]);
      if (encrypted.byteLength === 0) throw new Error("age produced an empty encrypted file");
      return {
        encrypted,
        recoveredZipSha256: createHash("sha256").update(recovered).digest("hex"),
      };
    } finally {
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }
}
