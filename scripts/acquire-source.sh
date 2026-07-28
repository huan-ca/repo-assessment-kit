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

release_verifier="$repo_root/scripts/verify-release-assets.mjs"
[[ -f "$release_verifier" && ! -L "$release_verifier" ]] || {
  echo "RAK_ACQUISITION_BLOCKED code=release_verifier_unavailable remediation='Install the complete signed release bundle.'" >&2
  exit 78
}
verification_dir=$(mktemp -d "${TMPDIR:-/tmp}/rak-release-verify.XXXXXXXX")
chmod 0700 "$verification_dir"
verification_output="$verification_dir/verified.json"
cleanup_verification() {
  rm -f -- "$verification_output"
  rmdir -- "$verification_dir" 2>/dev/null || true
}
trap cleanup_verification EXIT HUP INT TERM
if ! node "$release_verifier" \
  --manifest "$repo_root/release/release-manifest.json" \
  --toolchain "$repo_root/release/toolchain.lock.json" \
  --signature "$repo_root/release/release-signature.json" \
  --trusted-key "$repo_root/release/release-signing-public-key.pem" \
  --output "$verification_output" >/dev/null 2>&1; then
  echo "RAK_ACQUISITION_BLOCKED code=release_assets_unverified remediation='Install valid signed release assets and provenance.'" >&2
  exit 77
fi
image=$(node -e '
  const fs = require("node:fs");
  const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  const reference = value?.images?.acquisition?.immutableReference;
  if (value?.profile !== "rak-verified-release/1.0.0" || value?.verified !== true ||
      typeof reference !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,300}@sha256:[0-9a-f]{64}$/.test(reference)) process.exit(1);
  process.stdout.write(reference);
' "$verification_output") || {
  echo "RAK_ACQUISITION_BLOCKED code=release_assets_malformed remediation='Regenerate and sign the frozen release bundle.'" >&2
  exit 77
}
cleanup_verification
trap - EXIT HUP INT TERM
docker image inspect "$image" >/dev/null 2>&1 || {
  echo "RAK_ACQUISITION_BLOCKED code=acquisition_image_unavailable remediation='Load the exact signed image; do not retag a substitute.'" >&2
  exit 69
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
