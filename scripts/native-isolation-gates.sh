#!/usr/bin/env bash
set -euo pipefail

./scripts/runtime-capability.sh --require-available
instance=${RAK_RUNTIME_INSTANCE:?RAK_RUNTIME_INSTANCE is required}

limactl shell "$instance" -- sh -eu -c '
  test -S "$XDG_RUNTIME_DIR/docker.sock"
  test ! -S /var/run/docker.sock
  docker info --format "{{json .SecurityOptions}}" | grep -q rootless
  test -f /sys/fs/cgroup/cgroup.controllers
  test -r /var/lib/rak-runtime/broker.attestation.json
  test "$(stat -c %a /var/lib/rak-runtime/broker.attestation.json)" = 400
'

# The broker release harness must install these fixed adversarial controls in the VM.
for control in request-guard egress-deny resource-limits emergency-stop residue-cleanup; do
  limactl shell "$instance" -- \
    /usr/local/libexec/rak-runtime-gate "$control" --fixture /var/lib/rak-runtime/fixtures/hostile
done

# A successful gate leaves no target container, network, volume, secret, or VM-side outbox residue.
limactl shell "$instance" -- /usr/local/libexec/rak-runtime-gate assert-clean
