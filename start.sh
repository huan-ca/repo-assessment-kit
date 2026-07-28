#!/usr/bin/env bash
set -euo pipefail

readonly EX_USAGE=64
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cd "$repo_root"

usage() {
  printf '%s\n' \
    "usage: ./start.sh [--provider codex|claude] [preflight|build-images|login|status|interactive]" \
    "       ./start.sh --provider codex|claude assess --repo /path/to/client-repository [--mount-ssh /path/to/.ssh]" \
    "       ./start.sh --provider codex|claude assess --git GIT_URL [--ref BRANCH_OR_TAG]" \
    "       ./start.sh --provider codex|claude run --config <path>" \
    "       ./start.sh --provider codex|claude resume --run-dir <path>" \
    "" \
    "With no command, start.sh runs the readiness check and explains the result." >&2
  exit "$EX_USAGE"
}

provider=${RAK_PROVIDER:-}
if [[ ${1:-} == --provider ]]; then
  [[ $# -ge 2 ]] || usage
  provider=$2
  shift 2
fi

case "$provider" in
  codex)
    provider_name=codex
    launcher="$repo_root/start-codex.sh"
    ;;
  claude|claude-code)
    provider_name=claude
    launcher="$repo_root/start-cc.sh"
    ;;
  "")
    if [[ -t 0 ]]; then
      printf '%s\n' \
        "Which coding assistant will run the assessment?" \
        "  1) Claude Code" \
        "  2) Codex"
      read -r -p "Choose 1 or 2: " selection
      case "$selection" in
        1)
          provider_name=claude
          launcher="$repo_root/start-cc.sh"
          ;;
        2)
          provider_name=codex
          launcher="$repo_root/start-codex.sh"
          ;;
        *) printf '%s\n' "Please run start.sh again and choose 1 or 2." >&2; exit "$EX_USAGE" ;;
      esac
    else
      printf '%s\n' \
        "Choose a provider: ./start.sh --provider claude" \
        "                 or ./start.sh --provider codex" >&2
      exit "$EX_USAGE"
    fi
    ;;
  *) printf '%s\n' "Provider must be codex or claude." >&2; exit "$EX_USAGE" ;;
esac

command=${1:-preflight}
if [[ $# -gt 0 ]]; then shift; fi
case "$command" in
  assess)
    exec "$repo_root/scripts/practical-assessment.sh" --provider "$provider_name" "$@"
    ;;
  build-images)
    [[ $# -eq 0 ]] || usage
    node "$repo_root/scripts/ensure-local-images.mjs"
    ;;
  preflight)
    [[ $# -eq 0 ]] || usage
    mkdir -p "$repo_root/generated"
    report=$(mktemp "$repo_root/generated/.preflight.XXXXXXXX.json")
    cleanup() { rm -f -- "$report"; }
    trap cleanup EXIT HUP INT TERM
    result=0
    "$launcher" preflight >"$report" || result=$?
    if ! node - "$report" <<'NODE'
const fs = require("node:fs");
const report = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const recommendation = report.recommendation ?? {
  label: report.status === "available" ? "Ready" : "Not ready",
  detail: "See the detailed readiness report.",
};
console.log("");
console.log(`Recommended mode: ${recommendation.label}`);
console.log(recommendation.detail);
if (report.blockers?.length) {
  console.log("");
  console.log("Required items:");
  for (const item of report.blockers) {
    console.log(`- ${item.detail}`);
    console.log(`  What to do: ${item.remediation}`);
  }
}
const browser = report.limitations?.browserCoverage ?? [];
if (browser.length && report.status === "available") {
  console.log("");
  console.log("Optional browser coverage:");
  console.log("- Screenshots and browser-flow checks are unavailable; the assessment can still continue.");
}
NODE
    then
      printf '%s\n' "The readiness result could not be read." >&2
      exit 65
    fi
    rootless_blocked=$(
      node -e '
        const fs = require("node:fs");
        const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.stdout.write(
          value.blockers?.some((item) => item.code === "docker_not_rootless") ? "yes" : "no",
        );
      ' "$report"
    )
    if [[ "$rootless_blocked" == yes && -t 0 ]]; then
      printf '\nWould you like guided help fixing the Docker safety check?\n'
      if read -r -p "Start guided Docker setup? [y/N]: " setup_answer &&
        [[ "$setup_answer" == y || "$setup_answer" == Y || "$setup_answer" == yes || "$setup_answer" == YES ]]
      then
        if "$repo_root/scripts/guided-rootless-docker.sh"; then
          rm -f -- "$report"
          trap - EXIT HUP INT TERM
          exec "$repo_root/start.sh" --provider "$provider_name" preflight
        fi
        printf '%s\n' "Docker setup did not complete. The assessment remains safely blocked." >&2
      fi
    fi
    local_images_missing=$(
      node -e '
        const fs = require("node:fs");
        const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.stdout.write(
          value.blockers?.some((item) => item.code === "local_provider_image_unavailable")
            ? "yes"
            : "no",
        );
      ' "$report"
    )
    docker_ready=$(
      node -e '
        const fs = require("node:fs");
        const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
        process.stdout.write(
          value.capabilities?.docker?.daemonReachable &&
          value.capabilities?.docker?.rootless &&
          value.capabilities?.docker?.composeV2
            ? "yes"
            : "no",
        );
      ' "$report"
    )
    if [[ "$local_images_missing" == yes && "$docker_ready" == yes && -t 0 ]]; then
      printf '\nThe assessment containers need to be built on this computer.\n'
      printf 'This downloads the pinned tools and can take several minutes the first time.\n'
      if read -r -p "Build them now? [Y/n]: " build_answer &&
        [[ -z "$build_answer" || "$build_answer" == y || "$build_answer" == Y ||
          "$build_answer" == yes || "$build_answer" == YES ]]
      then
        if node "$repo_root/scripts/ensure-local-images.mjs"; then
          rm -f -- "$report"
          trap - EXIT HUP INT TERM
          exec "$repo_root/start.sh" --provider "$provider_name" preflight
        fi
        printf '%s\n' "The local container build did not complete." >&2
      fi
    fi
    final_report="$repo_root/generated/preflight-latest.json"
    mv -f -- "$report" "$final_report"
    trap - EXIT HUP INT TERM
    printf '\nDetailed report: %s\n' "$final_report"
    if [[ "$result" -eq 0 && -t 0 ]]; then
      printf '\nThe kit is ready to assess a repository.\n'
      if read -r -p "Start the assessment now? [Y/n]: " assess_answer &&
        [[ -z "$assess_answer" || "$assess_answer" == y || "$assess_answer" == Y ||
          "$assess_answer" == yes || "$assess_answer" == YES ]]
      then
        read -r -p "Client repository path or Git URL: " client_repo
        if [[ "$client_repo" == *"://"* || "$client_repo" == git@*:* ]]; then
          read -r -p "Branch or tag (Enter for the repository default): " client_ref
          if [[ -n "$client_ref" ]]; then
            exec "$repo_root/scripts/practical-assessment.sh" \
              --provider "$provider_name" --git "$client_repo" --ref "$client_ref"
          fi
          exec "$repo_root/scripts/practical-assessment.sh" \
            --provider "$provider_name" --git "$client_repo"
        fi
        exec "$repo_root/scripts/practical-assessment.sh" \
          --provider "$provider_name" --repo "$client_repo"
      fi
    fi
    exit "$result"
    ;;
  login|status|interactive)
    [[ $# -eq 0 ]] || usage
    exec "$launcher" "$command"
    ;;
  run)
    [[ $# -eq 2 && $1 == --config && -n $2 ]] || usage
    exec "$launcher" run "$@"
    ;;
  resume)
    [[ $# -eq 2 && $1 == --run-dir && -n $2 ]] || usage
    exec "$launcher" resume "$@"
    ;;
  *) usage ;;
esac
