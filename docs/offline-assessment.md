# Offline local assessment

`scripts/run-offline-assessment.mjs` produces a deterministic, static assessment draft for an
existing local Git worktree. It does not clone, use the network, run target code, invoke package
managers, launch containers, or perform browser checks.

Build the five workspace packages used by the script, then run:

```sh
pnpm --filter @rak/contracts \
  --filter @rak/analyzers \
  --filter @rak/evidence \
  --filter @rak/reporting \
  --filter @rak/packaging build

node scripts/run-offline-assessment.mjs \
  --source /absolute/path/to/local-git-worktree \
  --project customer-portal \
  --discovery /absolute/path/to/discovery.json \
  --output-root generated
```

The equivalent root convenience command is:

```sh
pnpm assessment:offline \
  --source /absolute/path/to/local-git-worktree \
  --project customer-portal \
  --discovery /absolute/path/to/discovery.json \
  --output-root generated
```

The source must be the canonical root of a local Git worktree with a valid `HEAD`. The output root
must not be inside the source, and the source must not be inside the output root. For a repeatable
test or controlled dry run, add `--generated-at 2026-07-28T12:34:56.000Z`.

The discovery file has one entry for each of the ten frozen topics. Every entry must be either a
supported, provenance-labeled statement or an explicit unknown:

```json
{
  "topics": {
    "target-customers": {
      "statement": "Regional service teams use the product to coordinate customer work.",
      "provenance": "owner-stated",
      "speakerRole": "software owner",
      "capturedAt": "2026-07-28T12:34:56.000Z",
      "confidence": "high"
    },
    "buyers": {
      "unknown": {
        "reason": "No buyer interview was available.",
        "confidenceEffect": "Commercial conclusions remain low confidence.",
        "coverageEffect": "Repository evidence cannot establish purchasing behavior.",
        "followUp": "The engagement owner must identify buyer roles before release."
      },
      "provenance": "unverified",
      "confidence": "low"
    }
  }
}
```

The remaining required keys are:

```text
user-roles
customer-pain
valuable-workflows
alternatives-differentiators
revenue-retention-critical-behavior
contractual-obligations
expected-scale
feature-parity-expectations
```

The script rejects missing, duplicate, unknown, or contract-invalid discovery entries.

## Output and gates

The run directory is:

```text
<output-root>/<project>-<full-commit-sha>-<UTC-timestamp>/
```

It contains a `-DRAFT.zip`, a detached SHA-256 file, and a `-DRAFT.zip.validation.json` certificate.
The ZIP contains the feature/use-case catalog, static findings and evidence provenance,
all-ten-topic discovery data, coverage for all fifteen domains, the equal-criteria three-option
comparison, a screenshot-unavailable record, native assessment JSON, SARIF, CycloneDX, CSV, reports,
manifest, and checksums.

Before writing output, the script verifies:

- exact Git commit and object format;
- a byte-level before/after manifest and Git-status digest covering tracked and untracked source
  content;
- the normalized NUL-delimited Git dirty/untracked path inventory, which is recorded in
  `includedDirtyPaths` and bound into the frozen-working-tree manifest digest;
- all ten discovery topics;
- analyzer native references and coverage;
- the implemented strict SARIF and CycloneDX offline profiles;
- content safety and seeded-secret/host-path exclusion;
- report HTML and customer-content safety;
- manifest and checksum integrity;
- deterministic ZIP structure and a fresh Node-process ZIP reopen.

`data/source-integrity.json` records the separate before/after manifest, Git-status, and combined
source digests plus the included and excluded dirty-path inventories. The target snapshot repeats
the normalized path lists used by the manifest binding.

Unavailable scanners are recorded as unavailable and not invoked. Runtime and screenshots are
recorded as blocked or unavailable; they are never counted as passes.

The result is intentionally `DRAFT_VALIDATED_RELEASE_BLOCKED`. This local mode cannot create real
provider analyses, independent security or decision reviews, technical or lay human reviews, a
cross-provider equivalence certificate, or complete official-schema certification. Those gates are
listed in `data/package-status.json` and the external validation certificate. Do not rename this
draft or represent it as customer-released.

Offline local assessment supports only `frozen-working-tree` mode. It includes every modified and
untracked path in the inspected filesystem snapshot and rejects unsafe path encodings or control
characters. It does not silently fall back to `commit-only`; a future commit-only mode must assess
an archive made from `HEAD` and explicitly report every excluded working-tree path.
