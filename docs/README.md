# Repository Assessment Kit documentation

Choose the guide for your role:

- [Customer quickstart](customer-quickstart.md) — what the assessment does, the ten discovery
  topics, evidence and coverage meanings, and what to check before accepting delivery.
- [Operator runbook](operator-runbook.md) — local container preparation, provider flows, strict run
  configuration, local and SSH sources, safe runtime boundaries, recovery, and package verification.
- [Customer package review guide](package-review-guide.md) — report reading order and the questions
  a technical or lay reviewer should be able to answer.
- [Release checklist](release-checklist.md) — deterministic evidence already established and the
  mandatory real gates that still block customer release.
- [Supported coverage matrix](supported-coverage-matrix.md) — current platform, capability,
  ecosystem, and acceptance-criterion coverage without treating fixtures as release evidence.
- [Offline local assessment](offline-assessment.md) — deterministic local static draft command and
  its intentional release blockers.
- [Foundation security boundaries](foundation-security-boundaries.md) — the provider, acquisition,
  and hostile-target compartment boundary.

Safe, non-production sample discovery and run configurations are in `../examples/`.

No document authorizes delivery of a package marked `DRAFT_VALIDATED_RELEASE_BLOCKED` or
`customerReleaseAuthorized:false`.
