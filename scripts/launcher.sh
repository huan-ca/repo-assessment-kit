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
      "Restore scripts/public-release-transition.mjs from this repository." \
      "trusted public release transition is absent or symbolic"
    exit "$EX_CONFIG"
  fi
  exec node "$transition" "${transition_arguments[@]}"
fi

readonly engagement_id_helper="$repo_root/scripts/engagement-id.mjs"
if [[ ! -f "$engagement_id_helper" || -L "$engagement_id_helper" ]]; then
  blocked engagement_identity_unavailable \
    "Install the complete release bundle containing scripts/engagement-id.mjs." \
    "the engagement identity helper is absent or symbolic"
  exit "$EX_CONFIG"
fi
if ! engagement_id=$(node "$engagement_id_helper" --file "$repo_root/.rak_id" 2>/dev/null); then
  blocked invalid_engagement_id \
    "Let the launcher create .rak_id, fix an unsafe .rak_id, or set RAK_ENGAGEMENT_ID to a lowercase slug of 1-48 characters." \
    "a safe engagement identity could not be loaded or created"
  exit "$EX_CONFIG"
fi
export RAK_ENGAGEMENT_ID="$engagement_id"
readonly engagement_id
readonly home_volume="rak-${engagement_id}-${home_suffix}-home-v1"

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
      "Restore scripts/run-release-assessment.mjs from this repository; direct provider execution is never a fallback." \
      "trusted host release orchestrator is absent or is a symbolic link"
    exit "$EX_CONFIG"
  fi
  if [[ "$verb" == run ]]; then
    exec node "$orchestrator" run --provider "$provider" --config "$argument"
  fi
  exec node "$orchestrator" resume --provider "$provider" --run-dir "$argument"
fi

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
case "$image_key" in
  codex) readonly local_image="rak-codex:0.1.0" ;;
  claude) readonly local_image="rak-claude:0.1.0" ;;
esac
if ! image_id=$(docker image inspect --format '{{.Id}}' "$local_image" 2>/dev/null); then
  blocked provider_image_unavailable \
    "Run ./start.sh preflight and choose the local container build when prompted." \
    "the locally built provider image is absent"
  exit "$EX_UNAVAILABLE"
fi
if [[ ! "$image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  blocked provider_image_unpinned \
    "Run node scripts/ensure-local-images.mjs to rebuild the local provider image." \
    "Docker returned a non-content-addressed image identifier"
  exit "$EX_NOPERM"
fi
actual_provider=$(docker image inspect --format '{{index .Config.Labels "io.repo-assessment-kit.provider"}}' "$image_id" 2>/dev/null || true)
if [[ "$actual_provider" != "$provider_label" ]]; then
  blocked provider_image_identity_mismatch \
    "Rebuild the local image from the matching provider Dockerfile." \
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

exec docker "${docker_args[@]}" "$image_id" "$verb"
