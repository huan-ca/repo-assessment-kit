#!/usr/bin/env bash
set -euo pipefail

readonly EX_USAGE=64
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
cd "$repo_root"

usage() {
  printf '%s\n' \
    "usage: ./start.sh [--provider codex|claude] [preflight|login|status|interactive]" \
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
    final_report="$repo_root/generated/preflight-latest.json"
    mv -f -- "$report" "$final_report"
    trap - EXIT HUP INT TERM
    printf '\nDetailed report: %s\n' "$final_report"
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
