#!/usr/bin/env bash
set -euo pipefail

readonly EX_USAGE=64
readonly EX_UNAVAILABLE=69
readonly EX_NOPERM=77
readonly EX_CONFIG=78

blocked() {
  local code=$1
  local remediation=$2
  shift 2
  printf 'RAK_LAUNCHER_BLOCKED code=%s provider=%s detail="%s" remediation="%s"\n' \
    "$code" "$provider" "$*" "$remediation" >&2
}

usage() {
  [[ $# -eq 0 ]] || printf '%s\n' "trailing provider arguments are not accepted" >&2
  printf '%s\n' \
    "usage: start-{codex,cc}.sh login" \
    "       start-{codex,cc}.sh status" \
    "       start-{codex,cc}.sh interactive" \
    "       start-{codex,cc}.sh preflight" \
    "       start-{codex,cc}.sh run --config <path>" \
    "       start-{codex,cc}.sh resume --run-dir <path>" \
    "       start-{codex,cc}.sh pair --codex-run-dir <generated run> --claude-run-dir <generated run>" \
    "       start-{codex,cc}.sh review --pair-dir <generated pair> --record <signed review JSON>" \
    "       start-{codex,cc}.sh authorize --pair-dir <generated pair> --record <signed authorization JSON>" \
    "       start-{codex,cc}.sh release --pair-dir <generated pair>" >&2
  exit "$EX_USAGE"
}

provider=${1:-}
[[ -n "$provider" ]] || usage
shift
verb=${1:-}
[[ -n "$verb" ]] || usage
shift

case "$provider" in
  codex)
    readonly image_key=codex
    readonly provider_label=codex
    readonly home_suffix=codex
    ;;
  claude-code)
    readonly image_key=claude
    readonly provider_label=claude-code
    readonly home_suffix=claude
    ;;
  *) printf 'unsupported release provider\n' >&2; exit "$EX_USAGE" ;;
esac

argument=
transition_arguments=()
case "$verb" in
  login|status|interactive|preflight)
    [[ $# -eq 0 ]] || usage trailing
    ;;
  run)
    if [[ $# -eq 0 ]]; then
      blocked missing_release_config \
        "Supply run --config <path>; private provider execution requires the P5 task broker and is not exposed." \
        "run requires the P5 task broker through the trusted release orchestrator"
      exit "$EX_CONFIG"
    fi
    [[ $# -eq 2 && $1 == --config && -n $2 ]] || usage
    argument=$2
    ;;
  resume)
    if [[ $# -eq 0 ]]; then
      blocked missing_release_run_directory \
        "Supply resume --run-dir <release-run-path>; private provider execution requires the P5 task broker and is not exposed." \
        "resume requires the P5 task broker through the trusted release orchestrator"
      exit "$EX_CONFIG"
    fi
    [[ $# -eq 2 && $1 == --run-dir && -n $2 ]] || usage
    argument=$2
    ;;
  pair)
    [[ $# -eq 4 && $1 == --codex-run-dir && -n $2 && $3 == --claude-run-dir && -n $4 ]] || usage
    transition_arguments=(pair --codex-run-dir "$2" --claude-run-dir "$4")
    ;;
  review|authorize)
    [[ $# -eq 4 && $1 == --pair-dir && -n $2 && $3 == --record && -n $4 ]] || usage
    transition_arguments=("$verb" --pair-dir "$2" --record "$4")
    ;;
  release)
    [[ $# -eq 2 && $1 == --pair-dir && -n $2 ]] || usage
    transition_arguments=(release --pair-dir "$2")
    ;;
  *) usage ;;
esac

repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$repo_root"

if [[ "$verb" == pair || "$verb" == review || "$verb" == authorize || "$verb" == release ]]; then
  readonly transition="$repo_root/scripts/public-release-transition.mjs"
  if [[ ! -f "$transition" || -L "$transition" ]]; then
    blocked release_transition_unavailable \
      "Install the signed release bundle containing scripts/public-release-transition.mjs." \
      "trusted public release transition is absent or symbolic"
    exit "$EX_CONFIG"
  fi
  exec node "$transition" "${transition_arguments[@]}"
fi

if [[ "$verb" == preflight ]]; then
  exec node "$repo_root/scripts/runtime-preflight.mjs" --provider "$provider"
fi

if [[ "$verb" == run || "$verb" == resume ]]; then
  # The provider image's private task verb requires the P5 task broker and is
  # intentionally unreachable from this public launcher.
  if [[ "$verb" == run ]]; then
    if ! argument=$(node -e '
      const fs = require("node:fs");
      const path = require("node:path");
      const candidate = path.resolve(process.cwd(), process.argv[1]);
      let stat;
      try { stat = fs.lstatSync(candidate); } catch { process.exit(1); }
      if (!stat.isFile() || stat.isSymbolicLink()) process.exit(1);
      process.stdout.write(fs.realpathSync.native(candidate));
    ' "$argument"); then
      blocked invalid_release_config \
        "Supply one existing regular JSON configuration file by absolute or repository-relative path; symbolic links are refused." \
        "run configuration path is absent, non-regular, or symbolic"
      exit "$EX_CONFIG"
    fi
  else
    if ! argument=$(node -e '
      const fs = require("node:fs");
      const path = require("node:path");
      const root = fs.realpathSync.native(path.join(process.cwd(), ["gene", "rated"].join("")));
      const candidate = path.resolve(process.cwd(), process.argv[1]);
      let stat;
      try { stat = fs.lstatSync(candidate); } catch { process.exit(1); }
      if (!stat.isDirectory() || stat.isSymbolicLink()) process.exit(1);
      const resolved = fs.realpathSync.native(candidate);
      if (resolved === root || !resolved.startsWith(`${root}${path.sep}`)) process.exit(1);
      process.stdout.write(resolved);
    ' "$argument"); then
      blocked invalid_release_run_directory \
        "Supply an existing non-symbolic release run directory created by the release orchestrator." \
        "resume directory is absent, non-regular, symbolic, or outside the release output root"
      exit "$EX_CONFIG"
    fi
  fi
  readonly orchestrator="$repo_root/scripts/run-release-assessment.mjs"
  if [[ ! -f "$orchestrator" || -L "$orchestrator" ]]; then
    blocked orchestrator_unavailable \
      "Install the signed release bundle containing scripts/run-release-assessment.mjs; direct provider execution is never a fallback." \
      "trusted host release orchestrator is absent or is a symbolic link"
    exit "$EX_CONFIG"
  fi
  if [[ "$verb" == run ]]; then
    exec node "$orchestrator" run --provider "$provider" --config "$argument"
  fi
  exec node "$orchestrator" resume --provider "$provider" --run-dir "$argument"
fi

engagement_id=${RAK_ENGAGEMENT_ID:-}
if [[ ! "$engagement_id" =~ ^[a-z0-9][a-z0-9-]{0,47}$ ]]; then
  blocked invalid_engagement_id \
    "Set RAK_ENGAGEMENT_ID to a unique lowercase slug (1-48 characters) for this engagement." \
    "provider homes must never be shared across engagements; private execution requires the P5 task broker"
  exit "$EX_CONFIG"
fi
readonly home_volume="rak-${engagement_id}-${home_suffix}-home-v1"

readonly release_verifier="$repo_root/scripts/verify-release-assets.mjs"
readonly release_manifest="$repo_root/release/release-manifest.json"
readonly toolchain_lock="$repo_root/release/toolchain.lock.json"
readonly release_signature="$repo_root/release/release-signature.json"
readonly release_key="$repo_root/release/release-signing-public-key.pem"
if [[ ! -f "$release_verifier" || -L "$release_verifier" ]]; then
  blocked release_verifier_unavailable \
    "Install the signed release bundle containing scripts/verify-release-assets.mjs." \
    "release asset verifier is absent or symbolic"
  exit "$EX_CONFIG"
fi
verification_dir=$(mktemp -d "${TMPDIR:-/tmp}/rak-release-verify.XXXXXXXX") || exit "$EX_UNAVAILABLE"
chmod 0700 "$verification_dir"
verification_output="$verification_dir/verified.json"
cleanup_verification() { rm -f -- "$verification_output"; rmdir -- "$verification_dir" 2>/dev/null || true; }
trap cleanup_verification EXIT HUP INT TERM
if ! node "$release_verifier" \
  --manifest "$release_manifest" \
  --toolchain "$toolchain_lock" \
  --signature "$release_signature" \
  --trusted-key "$release_key" \
  --output "$verification_output" >/dev/null 2>&1; then
  blocked release_assets_unverified \
    "Install a complete signed release bundle with manifest, toolchain lock, signature, provenance evidence, and pinned public key." \
    "release asset verification failed; mutable tags and self-declared labels are never trusted"
  exit "$EX_NOPERM"
fi
if ! immutable_image=$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const reference = value?.images?.[process.argv[2]]?.immutableReference;
  if (value?.profile !== "rak-verified-release/1.0.0" || value?.verified !== true ||
      typeof reference !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,300}@sha256:[0-9a-f]{64}$/.test(reference)) process.exit(1);
  process.stdout.write(reference);
' "$verification_output" "$image_key"); then
  blocked release_assets_malformed \
    "Regenerate and sign the release bundle with the frozen release-assets verifier." \
    "verified release output did not contain the closed immutable provider reference"
  exit "$EX_NOPERM"
fi
cleanup_verification
trap - EXIT HUP INT TERM

if ! command -v docker >/dev/null 2>&1; then
  blocked docker_unavailable \
    "Install Docker with a rootless daemon, then run this launcher's preflight verb." \
    "docker CLI was not found"
  exit "$EX_UNAVAILABLE"
fi
if ! docker info >/dev/null 2>&1; then
  blocked docker_daemon_unavailable \
    "Start the rootless Docker daemon/context, then run this launcher's preflight verb." \
    "docker daemon is unreachable"
  exit "$EX_UNAVAILABLE"
fi
if ! docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q 'name=rootless'; then
  blocked docker_not_rootless \
    "Select an attested rootless Docker context; this launcher never falls back to a rootful daemon." \
    "active Docker daemon did not attest rootless mode"
  exit "$EX_NOPERM"
fi
if ! image_id=$(docker image inspect --format '{{.Id}}' "$immutable_image" 2>/dev/null); then
  blocked provider_image_unavailable \
    "Load the exact signed release image for this platform, then rerun preflight; do not retag a substitute." \
    "verified immutable provider image is absent locally"
  exit "$EX_UNAVAILABLE"
fi
if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  blocked provider_image_unpinned \
    "Rebuild the signed release provider image and verify its immutable content digest." \
    "Docker returned a non-content-addressed image identifier"
  exit "$EX_NOPERM"
fi
actual_provider=$(docker image inspect --format '{{index .Config.Labels "io.repo-assessment-kit.provider"}}' "$image_id" 2>/dev/null || true)
if [[ "$actual_provider" != "$provider_label" ]]; then
  blocked provider_image_identity_mismatch \
    "Use the release-owned image built from the matching pinned provider Dockerfile." \
    "provider image identity label is absent or mismatched"
  exit "$EX_NOPERM"
fi

docker_args=(
  run --rm --init --read-only
  --cap-drop ALL
  --security-opt no-new-privileges
  --pids-limit 256
  --memory 1g
  --cpus 2
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m
  --volume "$home_volume:/home/node"
)

if [[ "$verb" == status ]]; then
  docker_args+=(--network none)
else
  if [[ -z ${RAK_PROVIDER_NETWORK:-} || -z ${RAK_PROVIDER_EGRESS_ATTESTATION:-} || -z ${RAK_PROVIDER_NETWORK_NONCE:-} ]]; then
    blocked provider_egress_attestation_missing \
      "Have the trusted host helper create a provider-inference network and issue one fresh signed nonce-bound attestation." \
      "$verb requires an attested provider-inference network"
    exit "$EX_NOPERM"
  fi
  if ! network_id=$(docker network inspect --format '{{.Id}}' "$RAK_PROVIDER_NETWORK" 2>/dev/null); then
    blocked provider_network_unavailable \
      "Have the trusted host helper recreate the exact attested provider-inference network." \
      "attested provider network does not exist"
    exit "$EX_NOPERM"
  fi
  node "$repo_root/scripts/verify-network-attestation.mjs" \
    provider-inference "$provider" "$RAK_PROVIDER_NETWORK" "$network_id" \
    "$RAK_PROVIDER_NETWORK_NONCE" "$RAK_PROVIDER_EGRESS_ATTESTATION"
  docker_args+=(--network "$RAK_PROVIDER_NETWORK")
fi

if [[ "$verb" == login || "$verb" == interactive ]]; then
  [[ -t 0 && -t 1 ]] || {
    blocked interactive_terminal_required \
      "Run this command from an interactive terminal; provider credentials are never accepted through launcher arguments or environment forwarding." \
      "$verb requires a TTY"
    exit "$EX_CONFIG"
  }
  docker_args+=(-it)
fi

exec docker "${docker_args[@]}" "$immutable_image" "$verb"
