import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ageCliCapability, type VerifiedAgeReleaseAuthority } from "../src/index.js";

describe("age CLI release authority", () => {
  it("rejects a fake executable that prints the pinned version before executing it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "rak-fake-age-"));
    const executable = join(directory, "age");
    const marker = join(directory, "executed");
    await writeFile(
      executable,
      `#!/bin/sh\nprintf 'executed' > '${marker}'\nprintf 'v1.3.1\\n'\n`,
      { mode: 0o700 },
    );
    await chmod(executable, 0o500);
    const platform = process.arch === "arm64" ? "linux/arm64" : "linux/amd64";
    const executableSha256 =
      platform === "linux/arm64"
        ? "92da3edf27811a65a599342d743a13bb50b7f0b07f8947530d4e83249f2e4532"
        : "2e305637f2a0555305e21c17fb74446acbb39b53135d43d4b744e50c287133a5";
    const authority: VerifiedAgeReleaseAuthority = {
      profile: "rak-verified-release/1.0.0",
      verified: true,
      toolchainLockSha256: "a".repeat(64),
      tools: {
        age: {
          version: "1.3.1",
          platform,
          executableSha256,
          stagedPath: executable,
        },
      },
    };

    const capability = await ageCliCapability(executable, authority);

    expect(capability).toMatchObject({
      available: false,
      reason: expect.stringMatching(/digest does not match/u),
    });
    await expect(readFile(marker)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports exact signed authority as required", async () => {
    const capability = await ageCliCapability("/missing/age");
    expect(capability).toMatchObject({
      available: false,
      reason: expect.stringContaining("verified signed release authority"),
    });
  });
});
