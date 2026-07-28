import { lstatSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";

const [mode, outputInput, ...protectedInputs] = process.argv.slice(2);
if (!["local", "ssh"].includes(mode) || !outputInput || protectedInputs.length < 1) {
  console.error("acquisition path arguments are invalid");
  process.exit(64);
}
const canonical = (input, expected) => {
  const lexical = path.resolve(input);
  let stat;
  let resolved;
  try {
    stat = lstatSync(lexical);
    resolved = realpathSync.native(lexical);
  } catch {
    throw new Error(`${expected} must already exist`);
  }
  if (lexical !== resolved || stat.isSymbolicLink()) {
    throw new Error(`${expected} must be a canonical path without symlink aliases`);
  }
  return { path: resolved, stat };
};
const overlaps = (left, right) => {
  const relation = path.relative(left, right);
  return (
    relation === "" ||
    (!relation.startsWith(`..${path.sep}`) && relation !== ".." && !path.isAbsolute(relation))
  );
};

try {
  const output = canonical(outputInput, "output");
  if (!output.stat.isDirectory()) throw new Error("output must be a directory");
  if (output.stat.uid !== process.getuid())
    throw new Error("output must be owned by the invoking user");
  if ((output.stat.mode & 0o022) !== 0) throw new Error("output must not be group/world writable");
  if (readdirSync(output.path).length !== 0) throw new Error("output must be empty");

  const protectedPaths = protectedInputs.map((input, index) =>
    canonical(input, `protected path ${index + 1}`),
  );
  if (mode === "local") {
    if (!protectedPaths[0].stat.isDirectory()) throw new Error("local source must be a directory");
  } else {
    if (protectedPaths.length !== 4)
      throw new Error("SSH requires key, known_hosts, and both parents");
    if (!protectedPaths[0].stat.isFile() || !protectedPaths[1].stat.isFile()) {
      throw new Error("SSH inputs must be regular files");
    }
    if ((protectedPaths[0].stat.mode & 0o077) !== 0) {
      throw new Error("SSH private key must not be accessible to group or other");
    }
  }
  for (const protectedPath of protectedPaths) {
    if (overlaps(output.path, protectedPath.path) || overlaps(protectedPath.path, output.path)) {
      throw new Error("output and protected acquisition paths must be disjoint");
    }
  }
} catch (error) {
  console.error(`acquisition path refused: ${error instanceof Error ? error.message : "invalid"}`);
  process.exit(66);
}
