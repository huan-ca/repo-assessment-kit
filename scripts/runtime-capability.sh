#!/usr/bin/env bash
set -euo pipefail

require_available=0
if [[ ${1:-} == --require-available && $# -eq 1 ]]; then
  require_available=1
elif [[ $# -ne 0 ]]; then
  echo "usage: runtime-capability.sh [--require-available]" >&2
  exit 64
fi

code=
detail=
remediation=
block() {
  if [[ -z "$code" ]]; then
    code=$1
    detail=$2
    remediation=$3
  fi
}
guest_check() {
  "$lima_binary" shell "$instance" -- sh -eu -c "$1" >/dev/null 2>&1
}

helper_config=/etc/repo-assessment-kit/host-helper.json
if [[ ! -f "$helper_config" || -L "$helper_config" ]] ||
   [[ $(stat -c '%u:%a' "$helper_config" 2>/dev/null || true) != 0:440 ]]; then
  block helper_config_unavailable "The root-owned helper configuration is unavailable." \
    "Install the signed production helper configuration; environment-selected runtimes are prohibited."
fi
runtime_binding=
if [[ -z "$code" ]]; then
  runtime_binding=$(node --input-type=module -e '
    import {readFileSync} from "node:fs";
    const c=JSON.parse(readFileSync(process.argv[1],"utf8"));
    const l=c?.runtime?.lima;
    if(c?.schemaVersion!=="rak-host-helper-config/1.0.0" || typeof l?.binary!=="string" || typeof l?.instance!=="string") process.exit(1);
    process.stdout.write(`${l.binary}\n${l.instance}`);
  ' "$helper_config" 2>/dev/null) || block helper_config_invalid \
    "The helper runtime registration is invalid." "Reinstall the signed helper configuration."
fi
lima_binary=${runtime_binding%%$'\n'*}
instance=${runtime_binding#*$'\n'}
if [[ -z "$code" && ( ! -x "$lima_binary" || -L "$lima_binary" ) ]]; then
  block lima_unavailable "The registered Lima binary is unavailable." \
    "Install the exact signed native Lima binary registered by the helper."
fi
if [[ ! "$instance" =~ ^rak-runtime-[a-zA-Z0-9_-]{1,48}$ ]]; then
  block invalid_runtime_instance "RAK_RUNTIME_INSTANCE is absent or invalid." \
    "Set it to the exact release-owned disposable instance name (rak-runtime-*)."
fi
if [[ -z "$code" ]] && ! "$lima_binary" shell "$instance" -- sh -eu -c 'exit 0' >/dev/null 2>&1; then
  block runtime_unreachable "The named Lima runtime is not running or reachable." \
    "Create a fresh runtime from container/runtime/lima.yaml; do not repair one containing target data."
fi

if [[ -z "$code" ]]; then
  host_arch=$(uname -m)
  case "$host_arch" in
    arm64|aarch64) expected_guest_arch=aarch64 ;;
    x86_64|amd64) expected_guest_arch=x86_64 ;;
    *) expected_guest_arch=unsupported ;;
  esac
  if [[ "$expected_guest_arch" == unsupported ]]; then
    block unsupported_host_architecture "Host architecture is outside the release matrix." \
      "Use native Linux/macOS ARM64 or x86-64 release hardware."
  elif ! guest_check "test \"\$(uname -m)\" = \"$expected_guest_arch\""; then
    block non_native_runtime "Guest architecture does not match the host architecture." \
      "Destroy the instance and create a native-architecture Lima runtime; emulation is not accepted."
  fi
fi
if [[ -z "$code" ]] && ! guest_check '
  test -f /sys/fs/cgroup/cgroup.controllers
  controllers=$(cat /sys/fs/cgroup/cgroup.controllers)
  for required in cpu io memory pids; do
    case " $controllers " in *" $required "*) ;; *) exit 1;; esac
  done
'; then
  block cgroup_v2_unavailable "Required delegated cgroup v2 controllers are unavailable." \
    "Provision a guest with delegated cpu, io, memory, and pids controllers."
fi
if [[ -z "$code" ]] && ! guest_check '
  command -v docker >/dev/null
  docker info --format "{{json .SecurityOptions}}" | grep -q "name=rootless"
  test "$(docker info --format "{{.CgroupVersion}}")" = "2"
  test "$(docker info --format "{{.CgroupDriver}}")" = "systemd"
  test -n "${XDG_RUNTIME_DIR:-}"
  test -S "$XDG_RUNTIME_DIR/docker.sock"
  test ! -S /var/run/docker.sock
'; then
  block rootless_runtime_unattested "Rootless Docker, systemd/cgroup v2, or socket isolation failed." \
    "Reprovision the runtime broker; never expose a host or rootful Docker socket."
fi
if [[ -z "$code" ]] && ! guest_check '
  test -r /etc/subuid && test -r /etc/subgid
  awk -F: '"'"'$3 >= 65536 {found=1} END {exit !found}'"'"' /etc/subuid
  awk -F: '"'"'$3 >= 65536 {found=1} END {exit !found}'"'"' /etc/subgid
'; then
  block subordinate_ids_unavailable "The guest lacks the required subordinate UID/GID ranges." \
    "Provision at least 65,536 subordinate UIDs and GIDs for the rootless broker identity."
fi
if [[ -z "$code" ]] && ! guest_check '
  test -f /var/lib/rak-runtime/broker.attestation.json
  test ! -L /var/lib/rak-runtime/broker.attestation.json
  test "$(stat -c %u /var/lib/rak-runtime/broker.attestation.json)" = 0
  test "$(stat -c %a /var/lib/rak-runtime/broker.attestation.json)" = 400
  test -x /usr/local/bin/rak-runtime-broker
  test -x /usr/local/libexec/rak-runtime-gate
'; then
  block broker_attestation_unavailable "The root-owned broker attestation or fixed gate is absent." \
    "Promote and install the signed broker/runtime image; fabricated attestations are prohibited."
fi

if [[ -n "$code" ]]; then
  printf '{"schemaVersion":"rak-runtime-capability/1.0.0","status":"blocked","reason":{"code":"%s","detail":"%s","remediation":"%s"}}\n' \
    "$code" "$detail" "$remediation"
  if [[ $require_available -eq 1 ]]; then exit 1; fi
  exit 0
fi
printf '%s\n' '{"schemaVersion":"rak-runtime-capability/1.0.0","status":"available","reason":null}'
