#!/usr/bin/env bash
set -euo pipefail

mode=${1:-}
repo_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
case "$mode" in
  local)
    [[ $# -eq 4 ]] || {
      echo "usage: acquire-source.sh local REPOSITORY REF OUTPUT_DIR" >&2
      exit 64
    }
    ref=$3
    [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$ && "$ref" != *..* ]] || {
      echo "ref contains unsupported characters" >&2
      exit 64
    }
    node "$repo_root/scripts/validate-acquisition-paths.mjs" local "$4" "$2" "$2/.git"
    source_path=$(realpath -e -- "$2")
    [[ -d "$source_path/.git" ]] || {
      echo "local source must be a Git repository" >&2
      exit 66
    }
    echo "RAK_ACQUISITION_BLOCKED code=LOCAL_FROZEN_SNAPSHOT_HELPER_REQUIRED detail='git archive cannot represent dirty and untracked frozen-working-tree bytes' remediation='Use the trusted immutable local snapshot seam; no commit-only fallback is permitted.'" >&2
    exit 78
    ;;
  ssh)
    [[ $# -eq 6 ]] || {
      echo "usage: acquire-source.sh ssh URL REF PRIVATE_KEY KNOWN_HOSTS OUTPUT_DIR" >&2
      exit 64
    }
    url=$2
    ref=$3
    [[ "$ref" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$ && "$ref" != *..* ]] || {
      echo "ref contains unsupported characters" >&2
      exit 64
    }
    node "$repo_root/scripts/validate-acquisition-paths.mjs" \
      ssh "$6" "$4" "$5" "$(dirname -- "$4")" "$(dirname -- "$5")"
    key=$(realpath -e -- "$4")
    known_hosts=$(realpath -e -- "$5")
    output=$(realpath -e -- "$6")
    if [[ -z ${RAK_GIT_NETWORK:-} || -z ${RAK_GIT_EGRESS_ATTESTATION:-} || -z ${RAK_GIT_NETWORK_NONCE:-} ]]; then
      echo "SSH acquisition requires a signed, nonce-bound git-acquisition network attestation" >&2
      exit 77
    fi
    network_args=(--network "$RAK_GIT_NETWORK")
    input_args=(
      --volume "$key:/run/secrets/key:ro"
      --volume "$known_hosts:/run/secrets/known_hosts:ro"
    )
    container_args=(ssh "$ref" "$url")
    ;;
  *) echo "mode must be local or ssh" >&2; exit 64 ;;
esac

command -v docker >/dev/null 2>&1 || {
  echo "RAK_ACQUISITION_BLOCKED code=docker_unavailable remediation='Install rootless Docker.'" >&2
  exit 69
}
docker info >/dev/null 2>&1 || {
  echo "RAK_ACQUISITION_BLOCKED code=docker_daemon_unavailable remediation='Start rootless Docker.'" >&2
  exit 69
}
docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q 'name=rootless' || {
  echo "RAK_ACQUISITION_BLOCKED code=docker_not_rootless remediation='Select an attested rootless Docker context.'" >&2
  exit 77
}

image=$(docker image inspect --format '{{.Id}}' rak-acquisition:0.1.0 2>/dev/null) || {
  echo "RAK_ACQUISITION_BLOCKED code=acquisition_image_unavailable remediation='Run ./start.sh build-images.'" >&2
  exit 69
}
[[ "$image" =~ ^sha256:[0-9a-f]{64}$ ]] || {
  echo "RAK_ACQUISITION_BLOCKED code=acquisition_image_invalid remediation='Rebuild the local images.'" >&2
  exit 77
}
component=$(docker image inspect \
  --format '{{index .Config.Labels "io.repo-assessment-kit.component"}}' "$image" 2>/dev/null || true)
[[ "$component" == acquisition ]] || {
  echo "RAK_ACQUISITION_BLOCKED code=acquisition_image_mismatched remediation='Rebuild the local images.'" >&2
  exit 77
}

if [[ "$mode" == ssh ]]; then
  network_id=$(docker network inspect --format '{{.Id}}' "$RAK_GIT_NETWORK" 2>/dev/null) || {
    echo "Git acquisition network does not exist" >&2
    exit 77
  }
  node "$repo_root/scripts/verify-network-attestation.mjs" \
    git-acquisition "$url" "$RAK_GIT_NETWORK" "$network_id" \
    "$RAK_GIT_NETWORK_NONCE" "$RAK_GIT_EGRESS_ATTESTATION"
fi

container_id=$(docker create --read-only --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 128 --memory 512m --cpus 1 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m \
  "${network_args[@]}" "${input_args[@]}" --mount type=volume,destination=/out \
  "$image" "${container_args[@]}")
cleanup() {
  docker rm --force --volumes "$container_id" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM
docker start --attach "$container_id"
docker cp "$container_id:/out/." "$output/"
