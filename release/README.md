# Release contracts

The client runtime does not download signed or prebuilt container images. On first use, `./start.sh`
offers to build the Codex, Claude Code, source-acquisition, and browser containers directly from the
Dockerfiles in this repository.

The resulting local image IDs and a fingerprint of their source files are recorded in the gitignored
file:

```text
generated/local-images.json
```

Run this command to build or refresh them explicitly:

```sh
./start.sh --provider claude build-images
```

Replace `claude` with `codex` if desired. The same four images are built either way. Docker’s build
cache is reused when the inputs have not changed.

The JSON schemas in this directory govern assessment-package review and authorization records. Those
package-level review signatures are separate from container delivery; they do not require GHCR, a
protected GitHub environment, or a container release-signing key.

`toolchain.lock.json` remains an inventory of optional external analysis tools. Missing optional
tools must be reported as limitations and must never be represented as having run.
