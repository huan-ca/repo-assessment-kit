#!/bin/sh
set -eu

mode=${1:?mode is required}
ref=${2:-HEAD}
umask 077
work=/tmp/acquisition
archive=/out/snapshot.tar
identity=/out/identity.json
mkdir -p "$work"
test ! -e "$archive" && test ! -e "$identity"

case "$mode" in
  local)
    test "$#" -eq 2
    echo "RAK_ACQUISITION_BLOCKED code=LOCAL_FROZEN_SNAPSHOT_HELPER_REQUIRED detail='commit archives omit dirty and untracked frozen-working-tree bytes' remediation='Use the trusted immutable local snapshot seam; this container accepts SSH commit snapshots only.'" >&2
    exit 78
    ;;
  ssh)
    test "$#" -eq 3
    url=$3
    case "$url" in
      ssh://*|git@*:* ) ;;
      *) echo "only normalized SSH Git URLs are accepted" >&2; exit 64 ;;
    esac
    export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
    export GIT_SSH_COMMAND="ssh -F /dev/null -i /run/secrets/key -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/run/secrets/known_hosts -o BatchMode=yes"
    git -c core.hooksPath=/dev/null -c protocol.file.allow=never \
      clone --no-checkout --no-tags --depth=1 --branch="$ref" "$url" "$work/repository"
    commit=$(git -C "$work/repository" rev-parse --verify HEAD^{commit})
    git -C "$work/repository" archive --format=tar --output="$archive" "$commit"
    ;;
  *) echo "unsupported acquisition mode" >&2; exit 64 ;;
esac

archive_digest=$(sha256sum "$archive" | cut -d ' ' -f 1)
chmod 0400 "$archive"
node - "$commit" "$archive_digest" >"$identity" <<'NODE'
const [commitSha, archiveSha256] = process.argv.slice(2);
process.stdout.write(`${JSON.stringify({
  schemaVersion: "rak-acquisition-identity/1.0.0",
  acquisitionKind: "ssh",
  snapshotMode: "immutable-commit",
  commitSha,
  archiveSha256,
})}\n`);
NODE
chmod 0400 "$identity"
