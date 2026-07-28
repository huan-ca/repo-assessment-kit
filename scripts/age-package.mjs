import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { AgeCliEncryptionProvider, ageCliCapability } from "../packages/packaging/dist/index.js";

function fail(message, code = 1) {
  process.stderr.write(`age package failed: ${message}\n`);
  process.exit(code);
}

function parseOptions(args) {
  const command = args.shift();
  if (command !== "capability" && command !== "encrypt-verify")
    fail(
      "usage: age-package.mjs capability [--age-bin FILE --verified-release FILE] | encrypt-verify --age-bin FILE --verified-release FILE --input ZIP --output ZIP.age --recipient AGE_RECIPIENT --identity IDENTITY_FILE",
      64,
    );
  const values = { command };
  while (args.length > 0) {
    const option = args.shift();
    const key = {
      "--age-bin": "ageBinary",
      "--input": "input",
      "--output": "output",
      "--recipient": "recipient",
      "--identity": "identityFile",
      "--verified-release": "verifiedRelease",
    }[option];
    const value = args.shift();
    if (key === undefined || value === undefined)
      fail(`unknown or incomplete option ${option}`, 64);
    values[key] = key === "recipient" ? value : path.resolve(value);
  }
  return values;
}

async function requireRegularInput(filePath) {
  const info = await lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error("input ZIP must be a regular file");
}

const options = parseOptions(process.argv.slice(2));
try {
  const releaseAuthority =
    options.verifiedRelease === undefined
      ? undefined
      : JSON.parse(await readFile(options.verifiedRelease, "utf8"));
  const capability = await ageCliCapability(options.ageBinary, releaseAuthority);
  if (options.command === "capability") {
    process.stdout.write(`${JSON.stringify(capability)}\n`);
    process.exitCode = capability.available ? 0 : 2;
  } else {
    if (
      options.ageBinary === undefined ||
      options.input === undefined ||
      options.output === undefined ||
      options.recipient === undefined ||
      options.identityFile === undefined ||
      releaseAuthority === undefined
    )
      fail("encrypt-verify requires age binary, input, output, recipient, and identity", 64);
    if (!capability.available) fail(capability.reason, 2);
    await requireRegularInput(options.input);
    const plain = await readFile(options.input);
    const plainSha256 = createHash("sha256").update(plain).digest("hex");
    const provider = new AgeCliEncryptionProvider({
      ageBinary: options.ageBinary,
      recipient: options.recipient,
      identityFile: options.identityFile,
      releaseAuthority,
    });
    const result = await provider.encryptAndVerify(plain);
    if (result.recoveredZipSha256 !== plainSha256)
      throw new Error("recovered ZIP digest does not match the plaintext input");
    await writeFile(options.output, result.encrypted, { flag: "wx", mode: 0o600 });
    const encryptedSha256 = createHash("sha256").update(result.encrypted).digest("hex");
    await writeFile(
      `${options.output}.sha256`,
      `${encryptedSha256}  ${path.basename(options.output)}\n`,
      { flag: "wx", mode: 0o600 },
    );
    process.stdout.write(
      `${JSON.stringify({
        status: "created-and-recovered",
        mechanism: "age-v1",
        provider: "age-cli/1.3.1",
        output: options.output,
        encryptedSha256,
        recoveredZipSha256: result.recoveredZipSha256,
      })}\n`,
    );
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "unknown encryption error");
}
