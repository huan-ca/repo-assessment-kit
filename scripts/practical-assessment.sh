#!/usr/bin/env bash
set -euo pipefail
trap 'status=$?; printf "Assessment stopped at line %s while running: %s\\n" "$LINENO" "$BASH_COMMAND" >&2; exit "$status"' ERR

readonly EX_USAGE=64
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
provider=
source_repo=
git_url=
git_ref=
ssh_dir=

usage() {
  printf '%s\n' \
    "usage: ./start.sh --provider codex|claude assess --repo /path/to/client-repository [--mount-ssh /path/to/.ssh]" \
    "       ./start.sh --provider codex|claude assess --git GIT_URL [--ref BRANCH_OR_TAG] [--mount-ssh /path/to/.ssh]" >&2
  exit "$EX_USAGE"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --provider) [[ $# -ge 2 ]] || usage; provider=$2; shift 2 ;;
    --repo) [[ $# -ge 2 ]] || usage; source_repo=$2; shift 2 ;;
    --git) [[ $# -ge 2 ]] || usage; git_url=$2; shift 2 ;;
    --ref) [[ $# -ge 2 ]] || usage; git_ref=$2; shift 2 ;;
    --mount-ssh) [[ $# -ge 2 ]] || usage; ssh_dir=$2; shift 2 ;;
    *) usage ;;
  esac
done
[[ "$provider" == codex || "$provider" == claude ]] || usage
if [[ -n "$source_repo" && -n "$git_url" ]] || [[ -z "$source_repo" && -z "$git_url" ]]; then
  usage
fi
if [[ -n "$source_repo" ]]; then
  source_repo=$(cd -- "$source_repo" && pwd -P)
  [[ -d "$source_repo" ]] || usage
fi
if [[ -n "$git_ref" && ! "$git_ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$ ]]; then
  printf 'Git branch or tag contains unsupported characters.\n' >&2
  exit "$EX_USAGE"
fi
if [[ -n "$git_url" &&
  ! "$git_url" =~ ^https://[^[:space:]]+$ &&
  ! "$git_url" =~ ^ssh://[^[:space:]]+$ &&
  ! "$git_url" =~ ^git@[^[:space:]:]+:[^[:space:]]+$ ]]
then
  printf 'Git URL must use HTTPS or SSH.\n' >&2
  exit "$EX_USAGE"
fi

node "$repo_root/scripts/ensure-local-images.mjs"
engagement_id=$(node "$repo_root/scripts/engagement-id.mjs" --file "$repo_root/.rak_id")
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
run_dir="$repo_root/generated/${engagement_id}-${timestamp}"
workspace="$run_dir/workspace"
output="$run_dir/reports"
mkdir -p "$workspace" "$output"
chmod 0700 "$run_dir" "$workspace" "$output"
if [[ -n "$source_repo" ]]; then
  cp -R "$source_repo/." "$workspace/"
else
  clone_args=(clone --no-tags)
  if [[ -n "$git_ref" ]]; then
    clone_args+=(--branch "$git_ref" --single-branch)
  fi
  clone_args+=(-- "$git_url" "$workspace")
  printf 'Cloning client repository into the disposable workspace...\n'
  GIT_SSH_COMMAND='ssh -o IgnoreUnknown=UseKeychain' git "${clone_args[@]}"
fi

target_customer="Not supplied"
critical_workflows="Not supplied"
differentiators="Not supplied"
runtime_notes="Not supplied"
if [[ -t 0 ]]; then
  printf '\nA few short answers improve the business and feature-parity analysis.\n'
  read -r -p "Who is the target customer? (Enter to skip): " answer
  [[ -n "$answer" ]] && target_customer=$answer
  read -r -p "Which workflows must a replacement preserve? (Enter to skip): " answer
  [[ -n "$answer" ]] && critical_workflows=$answer
  read -r -p "What makes this product different from competitors? (Enter to skip): " answer
  [[ -n "$answer" ]] && differentiators=$answer
  read -r -p "Any test login, startup, or sandbox URL notes? (Enter to skip): " answer
  [[ -n "$answer" ]] && runtime_notes=$answer
fi
{
  printf '# Product-owner context\n\n'
  printf -- '- Target customer: %s\n' "$target_customer"
  printf -- '- Must-preserve workflows: %s\n' "$critical_workflows"
  printf -- '- Competitive differentiators: %s\n' "$differentiators"
  printf -- '- Runtime and sandbox notes: %s\n' "$runtime_notes"
} >"$output/owner-context.md"
chmod 0600 "$output/owner-context.md"

case "$provider" in
  codex) image=rak-codex:0.1.0; home_volume="rak-${engagement_id}-codex-home-v1" ;;
  claude) image=rak-claude:0.1.0; home_volume="rak-${engagement_id}-claude-home-v1" ;;
esac
workspace_volume="rak-${engagement_id}-${timestamp}-workspace"
reports_volume="rak-${engagement_id}-${timestamp}-reports"
docker volume create "$workspace_volume" >/dev/null
docker volume create "$reports_volume" >/dev/null
reports_exported=no
export_reports() {
  if [[ "$reports_exported" == no ]]; then
    mkdir -p "$output"
    if docker run --rm --user 0:0 --volume "$reports_volume:/source:ro" \
      --entrypoint tar "$image" -C /source -cf - . |
      tar -C "$output" -xf -
    then
      reports_exported=yes
      return 0
    fi
    printf 'Could not copy reports back to %s; Docker volume %s was retained.\n' \
      "$output" "$reports_volume" >&2
    return 1
  fi
}
cleanup_assessment_volumes() {
  if export_reports; then
    docker volume rm "$workspace_volume" "$reports_volume" >/dev/null 2>&1 || true
  fi
}
trap cleanup_assessment_volumes EXIT HUP INT TERM

tar -C "$workspace" -cf - . |
  docker run --rm -i --user 0:0 --volume "$workspace_volume:/destination" \
    --entrypoint sh "$image" -c \
    'tar -C /destination -xf - && chown -R 1000:1000 /destination'
tar -C "$output" -cf - . |
  docker run --rm -i --user 0:0 --volume "$reports_volume:/destination" \
    --entrypoint sh "$image" -c \
    'tar -C /destination -xf - && chown -R 1000:1000 /destination'

if ! docker run --rm --network none --volume "$home_volume:/home/node" "$image" status >/dev/null 2>&1; then
  if [[ ! -t 0 || ! -t 1 ]]; then
    printf 'Provider login is required. Run this command from an interactive terminal.\n' >&2
    exit 78
  fi
  printf '\nSign in to %s before the assessment begins.\n' "$provider"
  docker run --rm -it --volume "$home_volume:/home/node" "$image" login
fi
docker_args=(
  run --rm --init
  --cap-drop ALL
  --security-opt no-new-privileges
  --pids-limit 2048
  --memory 8g
  --cpus 4
  --volume "$workspace_volume:/workspace/target"
  --volume "$reports_volume:/workspace/output"
  --volume "$home_volume:/home/node"
)
if [[ -n "$ssh_dir" ]]; then
  ssh_dir=$(cd -- "$ssh_dir" && pwd -P)
  [[ -d "$ssh_dir" ]] || usage
  docker_args+=(--volume "$ssh_dir:/home/node/.ssh:ro")
fi

printf 'Assessment workspace: %s\n' "$workspace"
printf 'Reports will be written to: %s\n' "$output"
docker "${docker_args[@]}" --entrypoint node "$image" \
  /usr/local/lib/rak-practical-assessment.mjs "$provider"
export_reports
docker volume rm "$workspace_volume" "$reports_volume" >/dev/null 2>&1 || true
trap - EXIT HUP INT TERM
printf '\nOpen first: %s\n' "$output/executive-report.md"
printf 'ZIP package: %s\n' "$output/repo-assessment.zip"
