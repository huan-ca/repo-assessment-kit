#!/usr/bin/env bash
set -euo pipefail

CLIENT_UID=62345
CLIENT_GID=62345
NODE_VERSION=v24.4.1
INSTALL_ROOT=/usr/local/libexec/repo-assessment-kit
PEER_VERIFIER=/usr/local/libexec/rak-peer-cred
CONFIG=/etc/repo-assessment-kit/host-helper.json
CLIENT_KEY=/run/secrets/rak-host-helper-client.key
VERIFIED_RELEASE=/var/lib/repo-assessment-kit/release/verified-host-helper.txt
SOCKET_DIR=/var/run/repo-assessment-kit
JOURNAL_DIR=/var/lib/repo-assessment-kit/host-helper
TRANSFER_DIR=/var/lib/repo-assessment-kit/transfers

die() {
  printf '%s\n' "host-helper install: $*" >&2
  exit 78
}

[ "$#" -eq 1 ] || die "usage: install-production-host-helper.sh install|verify|--dry-run"
case "$1" in
  install|verify|--dry-run) MODE=$1 ;;
  *) die "usage: install-production-host-helper.sh install|verify|--dry-run" ;;
esac

[ "$(id -u)" -eq 0 ] || die "root is required"
OS=$(uname -s)
case "$OS" in
  Linux)
    PLATFORM=linux
    PAYLOAD_PLATFORM=linux
    ;;
  Darwin)
    PLATFORM=darwin
    PAYLOAD_PLATFORM=macos
    ;;
  *) die "unsupported operating system" ;;
esac
case "$(uname -m)" in
  x86_64|amd64) ARCHITECTURE=x86-64 ;;
  arm64|aarch64) ARCHITECTURE=arm64 ;;
  *) die "unsupported architecture" ;;
esac

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
PAYLOAD_DIR=$REPO_ROOT/container/runtime/install/payload/$PAYLOAD_PLATFORM-$ARCHITECTURE
NODE_PAYLOAD=$PAYLOAD_DIR/node
PEER_PAYLOAD=$PAYLOAD_DIR/rak-peer-cred

if [ "$MODE" = "--dry-run" ]; then
  printf '%s\n' \
    "Would install the fixed production host helper for $OS." \
    "Required external payloads: container/runtime/install/payload/$PAYLOAD_PLATFORM-$ARCHITECTURE/{node,rak-peer-cred}." \
    "Required preverified authority: $VERIFIED_RELEASE." \
    "Required provisioned authority: $CONFIG, $CLIENT_KEY, and every digest-bound file named by the config." \
    "Would create numeric client identity $CLIENT_UID:$CLIENT_GID and fixed runtime/state directories." \
    "Would install, but not start or enable, the platform service definition."
  exit 0
fi

mode_of() {
  if [ "$OS" = Linux ]; then stat -c '%a' "$1"; else stat -f '%Lp' "$1"; fi
}

uid_of() {
  if [ "$OS" = Linux ]; then stat -c '%u' "$1"; else stat -f '%u' "$1"; fi
}

gid_of() {
  if [ "$OS" = Linux ]; then stat -c '%g' "$1"; else stat -f '%g' "$1"; fi
}

require_regular() {
  [ -f "$1" ] && [ ! -L "$1" ] || die "$1 must be a non-symlink regular file"
}

require_directory() {
  [ -d "$1" ] && [ ! -L "$1" ] || die "$1 must be a non-symlink directory"
  [ "$(mode_of "$1")" = "$2" ] || die "$1 must have mode $2"
  [ "$(uid_of "$1")" = "$3" ] || die "$1 has the wrong owner"
  [ "$(gid_of "$1")" = "$4" ] || die "$1 has the wrong group"
}

refuse_symlink_target() {
  [ ! -L "$1" ] || die "$1 must not be a symbolic link"
}

require_root_controlled_directory() {
  require_directory_type=$1
  [ -d "$require_directory_type" ] && [ ! -L "$require_directory_type" ] ||
    die "$require_directory_type must be a non-symlink directory"
  [ "$(uid_of "$require_directory_type")" = 0 ] ||
    die "$require_directory_type must be root-owned"
  [ "$(gid_of "$require_directory_type")" = 0 ] ||
    die "$require_directory_type must be root-group-owned"
  directory_mode=$(mode_of "$require_directory_type")
  [ $((8#$directory_mode & 022)) -eq 0 ] ||
    die "$require_directory_type must not be group or other writable"
}

require_authorized_file() {
  key=$1
  path=$2
  require_regular "$path"
  expected=$(authority_value "$key")
  require_digest_value "$key" "$expected"
  [ "sha256:$(sha256_file "$path")" = "$expected" ] || die "$path differs from preverified authority"
}

verify_payload_tree() {
  root=$1
  require_authorized_file installerSha256 "$root/install-production-host-helper.sh"
  require_authorized_file nodeSha256 "$root/node"
  require_authorized_file peerVerifierSha256 "$root/rak-peer-cred"
  require_authorized_file productionHostHelperSha256 "$root/scripts/production-host-helper.mjs"
  require_authorized_file hostHelperServiceSha256 "$root/scripts/host-helper-service.mjs"
  require_authorized_file hostHelperJournalSha256 "$root/scripts/host-helper-journal.mjs"
  require_authorized_file hostHelperOperationsSha256 "$root/scripts/host-helper-operations.mjs"
  require_authorized_file hostHelperProtocolSha256 "$root/scripts/host-helper-protocol.mjs"
  require_authorized_file productionInstallationConfigSha256 \
    "$root/scripts/production-installation-config.mjs"
  require_authorized_file providerTaskSha256 "$root/container/provider-task.mjs"
  require_authorized_file installationValidatorSha256 "$root/validate-production-host-helper.mjs"
  require_authorized_file serviceEntrypointSha256 "$root/service-entrypoint.mjs"
  require_authorized_file linuxServiceDefinitionSha256 \
    "$root/repo-assessment-kit-host-helper.service"
  require_authorized_file macosServiceDefinitionSha256 \
    "$root/com.repo-assessment-kit.host-helper.plist"
}

stage_release_payload() {
  STAGE_ROOT=$(mktemp -d /var/lib/repo-assessment-kit/release/.host-helper-stage.XXXXXX)
  [ -d "$STAGE_ROOT" ] && [ ! -L "$STAGE_ROOT" ] || die "failed to create trusted staging"
  chown 0:0 "$STAGE_ROOT"
  chmod 0700 "$STAGE_ROOT"
  install -d -o root -g root -m 0700 "$STAGE_ROOT/scripts" "$STAGE_ROOT/container"
  install_file "$SCRIPT_DIR/install-production-host-helper.sh" \
    "$STAGE_ROOT/install-production-host-helper.sh" 0500
  install_file "$NODE_PAYLOAD" "$STAGE_ROOT/node" 0755
  install_file "$PEER_PAYLOAD" "$STAGE_ROOT/rak-peer-cred" 0755
  for file in production-host-helper.mjs host-helper-service.mjs host-helper-journal.mjs \
    host-helper-operations.mjs host-helper-protocol.mjs production-installation-config.mjs; do
    install_file "$REPO_ROOT/scripts/$file" "$STAGE_ROOT/scripts/$file" 0400
  done
  install_file "$REPO_ROOT/container/provider-task.mjs" "$STAGE_ROOT/container/provider-task.mjs" 0400
  install_file "$REPO_ROOT/container/runtime/install/validate-production-host-helper.mjs" \
    "$STAGE_ROOT/validate-production-host-helper.mjs" 0500
  install_file "$REPO_ROOT/container/runtime/install/service-entrypoint.mjs" \
    "$STAGE_ROOT/service-entrypoint.mjs" 0500
  install_file "$REPO_ROOT/container/runtime/install/repo-assessment-kit-host-helper.service" \
    "$STAGE_ROOT/repo-assessment-kit-host-helper.service" 0400
  install_file "$REPO_ROOT/container/runtime/install/com.repo-assessment-kit.host-helper.plist" \
    "$STAGE_ROOT/com.repo-assessment-kit.host-helper.plist" 0400
  verify_payload_tree "$STAGE_ROOT"
}

cleanup_stage() {
  case "${STAGE_ROOT:-}" in
    /var/lib/repo-assessment-kit/release/.host-helper-stage.*)
      [ ! -L "$STAGE_ROOT" ] || die "refusing unsafe staging cleanup"
      rm -rf -- "$STAGE_ROOT"
      ;;
    '') ;;
    *) die "refusing unsafe staging cleanup" ;;
  esac
}

sha256_file() {
  if [ "$OS" = Linux ]; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

authority_value() {
  awk -F= -v wanted="$1" '$1 == wanted { print substr($0, length($1) + 2) }' "$VERIFIED_RELEASE"
}

require_digest_value() {
  case "$2" in
    sha256:[0-9a-f][0-9a-f]*) ;;
    *) die "$1 must be a canonical SHA-256 digest" ;;
  esac
  [ "${#2}" -eq 71 ] || die "$1 must be a canonical SHA-256 digest"
  case "${2#sha256:}" in
    *[!0-9a-f]*) die "$1 must be a canonical SHA-256 digest" ;;
    *) ;;
  esac
}

require_payload_digest() {
  key=$1
  path=$2
  require_regular "$path"
  expected=$(authority_value "$key")
  require_digest_value "$key" "$expected"
  [ "sha256:$(sha256_file "$path")" = "$expected" ] || die "$key does not match preverified authority"
}

preverify_release_package() {
  require_root_controlled_directory /var/lib/repo-assessment-kit/release
  require_regular "$VERIFIED_RELEASE"
  [ "$(mode_of "$VERIFIED_RELEASE")" = 400 ] || die "$VERIFIED_RELEASE must have mode 400"
  [ "$(uid_of "$VERIFIED_RELEASE")" = 0 ] || die "$VERIFIED_RELEASE must be root-owned"
  [ "$(gid_of "$VERIFIED_RELEASE")" = 0 ] || die "$VERIFIED_RELEASE must be root-group-owned"

  awk '
    BEGIN {
      required = "profile verified sourceCommit manifestSha256 signingKeyId platform architecture nodeVersion installerSha256 nodeSha256 peerVerifierSha256 productionHostHelperSha256 hostHelperServiceSha256 hostHelperJournalSha256 hostHelperOperationsSha256 hostHelperProtocolSha256 productionInstallationConfigSha256 providerTaskSha256 installationValidatorSha256 serviceEntrypointSha256 linuxServiceDefinitionSha256 macosServiceDefinitionSha256"
      count = split(required, names, " ")
      for (index = 1; index <= count; index++) allowed[names[index]] = 1
    }
    {
      if ($0 !~ /^[A-Za-z][A-Za-z0-9]*=[^=[:space:]][^=[:space:]]*$/) exit 10
      separator = index($0, "=")
      key = substr($0, 1, separator - 1)
      if (!(key in allowed) || seen[key]++) exit 11
    }
    END {
      if (NR != count) exit 12
      for (key in allowed) if (seen[key] != 1) exit 13
    }
  ' "$VERIFIED_RELEASE" || die "$VERIFIED_RELEASE is malformed, incomplete, duplicate, or open"

  [ "$(authority_value profile)" = rak-verified-host-helper-release/1.0.0 ] ||
    die "verified host-helper profile is invalid"
  [ "$(authority_value verified)" = true ] || die "verified host-helper ceremony is incomplete"
  source_commit=$(authority_value sourceCommit)
  case "$source_commit" in
    *[!0-9a-f]*) die "sourceCommit is invalid" ;;
  esac
  [ "${#source_commit}" -ge 40 ] && [ "${#source_commit}" -le 64 ] ||
    die "sourceCommit is invalid"
  require_digest_value signingKeyId "$(authority_value signingKeyId)"
  require_digest_value manifestSha256 "$(authority_value manifestSha256)"
  [ "$(authority_value nodeVersion)" = "$NODE_VERSION" ] || die "Node version authority mismatch"

  [ "$(authority_value platform)" = "$PLATFORM" ] || die "verified authority platform mismatch"
  [ "$(authority_value architecture)" = "$ARCHITECTURE" ] ||
    die "verified authority architecture mismatch"

  require_payload_digest installerSha256 "$SCRIPT_DIR/install-production-host-helper.sh"
  require_payload_digest nodeSha256 "$NODE_PAYLOAD"
  require_payload_digest peerVerifierSha256 "$PEER_PAYLOAD"
  require_payload_digest productionHostHelperSha256 "$REPO_ROOT/scripts/production-host-helper.mjs"
  require_payload_digest hostHelperServiceSha256 "$REPO_ROOT/scripts/host-helper-service.mjs"
  require_payload_digest hostHelperJournalSha256 "$REPO_ROOT/scripts/host-helper-journal.mjs"
  require_payload_digest hostHelperOperationsSha256 "$REPO_ROOT/scripts/host-helper-operations.mjs"
  require_payload_digest hostHelperProtocolSha256 "$REPO_ROOT/scripts/host-helper-protocol.mjs"
  require_payload_digest productionInstallationConfigSha256 \
    "$REPO_ROOT/scripts/production-installation-config.mjs"
  require_payload_digest providerTaskSha256 "$REPO_ROOT/container/provider-task.mjs"
  require_payload_digest installationValidatorSha256 \
    "$REPO_ROOT/container/runtime/install/validate-production-host-helper.mjs"
  require_payload_digest serviceEntrypointSha256 \
    "$REPO_ROOT/container/runtime/install/service-entrypoint.mjs"
  require_payload_digest linuxServiceDefinitionSha256 \
    "$REPO_ROOT/container/runtime/install/repo-assessment-kit-host-helper.service"
  require_payload_digest macosServiceDefinitionSha256 \
    "$REPO_ROOT/container/runtime/install/com.repo-assessment-kit.host-helper.plist"
}

verify_identity() {
  if [ "$OS" = Linux ]; then
    getent passwd "$CLIENT_UID" | awk -F: -v uid="$CLIENT_UID" -v gid="$CLIENT_GID" '
      $3 == uid && $4 == gid && $1 == "rak-client" &&
      $6 == "/nonexistent" && $7 == "/usr/sbin/nologin" { found=1 }
      END { exit !found }
    ' || die "dedicated Linux client identity is missing or mismatched"
    getent group "$CLIENT_GID" | awk -F: -v gid="$CLIENT_GID" '
      $3 == gid && $1 == "rak-client" {
        if ($4 == "") found=1
      }
      END { exit !found }
    ' || die "dedicated Linux client group is missing or mismatched"
    getent passwd | awk -F: -v gid="$CLIENT_GID" '
      $4 == gid && $1 != "rak-client" { conflict=1 }
      END { exit conflict }
    ' || die "another Linux account uses the dedicated client primary group"
    [ "$(id -G rak-client)" = "$CLIENT_GID" ] ||
      die "dedicated Linux client has unrelated supplementary groups"
  else
    [ "$(dscl . -read /Users/_rakclient UniqueID 2>/dev/null | awk '{print $2}')" = "$CLIENT_UID" ] ||
      die "dedicated macOS client identity is missing or mismatched"
    [ "$(dscl . -read /Groups/_rakclient PrimaryGroupID 2>/dev/null | awk '{print $2}')" = "$CLIENT_GID" ] ||
      die "dedicated macOS client group is missing or mismatched"
    [ "$(dscl . -read /Users/_rakclient NFSHomeDirectory 2>/dev/null | awk '{print $2}')" = /var/empty ] ||
      die "dedicated macOS client home is mismatched"
    [ "$(dscl . -read /Users/_rakclient UserShell 2>/dev/null | awk '{print $2}')" = /usr/bin/false ] ||
      die "dedicated macOS client shell is mismatched"
    [ "$(dscl . -read /Users/_rakclient IsHidden 2>/dev/null | awk '{print $2}')" = 1 ] ||
      die "dedicated macOS client visibility is mismatched"
    group_members=$(dscl . -read /Groups/_rakclient GroupMembership 2>/dev/null || true)
    [ -z "$group_members" ] || die "dedicated macOS client group has supplemental members"
    primary_users=$(dscl . -search /Users PrimaryGroupID "$CLIENT_GID" 2>/dev/null |
      awk '$1 != "_rakclient" { print $1 }')
    [ -z "$primary_users" ] || die "another macOS account uses the dedicated client primary group"
  fi
}

create_identity() {
  if [ "$OS" = Linux ]; then
    if getent passwd "$CLIENT_UID" >/dev/null || getent passwd rak-client >/dev/null ||
       getent group "$CLIENT_GID" >/dev/null || getent group rak-client >/dev/null; then
      verify_identity
      return
    fi
    groupadd --system --gid "$CLIENT_GID" rak-client
    useradd --system --uid "$CLIENT_UID" --gid "$CLIENT_GID" --no-create-home \
      --home-dir /nonexistent --shell /usr/sbin/nologin rak-client
  else
    if dscl . -search /Users UniqueID "$CLIENT_UID" 2>/dev/null | grep -q . ||
       dscl . -read /Users/_rakclient >/dev/null 2>&1 ||
       dscl . -search /Groups PrimaryGroupID "$CLIENT_GID" 2>/dev/null | grep -q . ||
       dscl . -read /Groups/_rakclient >/dev/null 2>&1; then
      verify_identity
      return
    fi
    dscl . -create /Groups/_rakclient
    dscl . -create /Groups/_rakclient PrimaryGroupID "$CLIENT_GID"
    dscl . -create /Users/_rakclient
    dscl . -create /Users/_rakclient UniqueID "$CLIENT_UID"
    dscl . -create /Users/_rakclient PrimaryGroupID "$CLIENT_GID"
    dscl . -create /Users/_rakclient NFSHomeDirectory /var/empty
    dscl . -create /Users/_rakclient UserShell /usr/bin/false
    dscl . -create /Users/_rakclient IsHidden 1
  fi
  verify_identity
}

install_file() {
  source=$1
  destination=$2
  mode=$3
  install -o root -g "$(if [ "$OS" = Linux ]; then printf root; else printf wheel; fi)" \
    -m "$mode" "$source" "$destination"
}

verify_installation() {
  verify_identity
  require_directory "$SOCKET_DIR" 700 "$CLIENT_UID" "$CLIENT_GID"
  require_directory "$JOURNAL_DIR" 700 0 0
  require_directory "$TRANSFER_DIR" 710 0 "$CLIENT_GID"
  require_regular "$CONFIG"
  [ "$(mode_of "$CONFIG")" = 440 ] || die "$CONFIG must have mode 440"
  [ "$(uid_of "$CONFIG")" = 0 ] || die "$CONFIG must be root-owned"
  [ "$(gid_of "$CONFIG")" = "$CLIENT_GID" ] || die "$CONFIG must use the client group"
  require_regular "$CLIENT_KEY"
  [ "$(mode_of "$CLIENT_KEY")" = 600 ] || die "$CLIENT_KEY must have mode 600"
  [ "$(uid_of "$CLIENT_KEY")" = "$CLIENT_UID" ] || die "$CLIENT_KEY must use the client owner"
  [ "$(gid_of "$CLIENT_KEY")" = "$CLIENT_GID" ] || die "$CLIENT_KEY must use the client group"
  [ "$(wc -c < "$CLIENT_KEY" | tr -d ' ')" = 32 ] || die "$CLIENT_KEY must contain 32 raw bytes"
  if [ "$OS" = Linux ]; then
    service_file=/etc/systemd/system/repo-assessment-kit-host-helper.service
    service_key=linuxServiceDefinitionSha256
  else
    service_file=/Library/LaunchDaemons/com.repo-assessment-kit.host-helper.plist
    service_key=macosServiceDefinitionSha256
  fi
  require_regular "$service_file"
  [ "$(mode_of "$service_file")" = 444 ] || die "$service_file must have mode 444"
  [ "$(uid_of "$service_file")" = 0 ] || die "$service_file must be root-owned"
  require_authorized_file nodeSha256 "$INSTALL_ROOT/node"
  require_authorized_file peerVerifierSha256 "$PEER_VERIFIER"
  require_authorized_file productionHostHelperSha256 "$INSTALL_ROOT/scripts/production-host-helper.mjs"
  require_authorized_file hostHelperServiceSha256 "$INSTALL_ROOT/scripts/host-helper-service.mjs"
  require_authorized_file hostHelperJournalSha256 "$INSTALL_ROOT/scripts/host-helper-journal.mjs"
  require_authorized_file hostHelperOperationsSha256 "$INSTALL_ROOT/scripts/host-helper-operations.mjs"
  require_authorized_file hostHelperProtocolSha256 "$INSTALL_ROOT/scripts/host-helper-protocol.mjs"
  require_authorized_file productionInstallationConfigSha256 \
    "$INSTALL_ROOT/scripts/production-installation-config.mjs"
  require_authorized_file providerTaskSha256 "$INSTALL_ROOT/container/provider-task.mjs"
  require_authorized_file installationValidatorSha256 \
    "$INSTALL_ROOT/validate-production-host-helper.mjs"
  require_authorized_file serviceEntrypointSha256 "$INSTALL_ROOT/service-entrypoint.mjs"
  require_authorized_file "$service_key" "$service_file"
  [ "$("$INSTALL_ROOT/node" --version)" = "$NODE_VERSION" ] || die "installed Node version mismatch"
  "$INSTALL_ROOT/node" "$INSTALL_ROOT/validate-production-host-helper.mjs"
}

if [ "$MODE" = verify ]; then
  preverify_release_package
  verify_installation
  printf '%s\n' "host-helper installation verified; service state was not changed"
  exit 0
fi

preverify_release_package
stage_release_payload
trap cleanup_stage EXIT HUP INT TERM
require_regular "$CONFIG"
require_regular "$CLIENT_KEY"
for target in "$SOCKET_DIR" "$JOURNAL_DIR" "$TRANSFER_DIR" /etc/repo-assessment-kit \
  "$INSTALL_ROOT" "$PEER_VERIFIER" /etc/systemd/system/repo-assessment-kit-host-helper.service \
  /Library/LaunchDaemons/com.repo-assessment-kit.host-helper.plist; do
  refuse_symlink_target "$target"
done
create_identity

install -d -o "$CLIENT_UID" -g "$CLIENT_GID" -m 0700 "$SOCKET_DIR"
install -d -o root -g "$(if [ "$OS" = Linux ]; then printf root; else printf wheel; fi)" -m 0700 "$JOURNAL_DIR"
install -d -o root -g "$CLIENT_GID" -m 0710 "$TRANSFER_DIR"
install -d -o root -g "$CLIENT_GID" -m 0750 /etc/repo-assessment-kit
if [ ! -d /run/secrets ]; then
  install -d -o root -g "$(if [ "$OS" = Linux ]; then printf root; else printf wheel; fi)" -m 0755 /run/secrets
fi
install -d -o root -g "$(if [ "$OS" = Linux ]; then printf root; else printf wheel; fi)" -m 0755 \
  "$INSTALL_ROOT" "$INSTALL_ROOT/scripts" "$INSTALL_ROOT/container"

install_file "$STAGE_ROOT/node" "$INSTALL_ROOT/node" 0755
install_file "$STAGE_ROOT/rak-peer-cred" "$PEER_VERIFIER" 0755
for file in production-host-helper.mjs host-helper-service.mjs host-helper-journal.mjs \
  host-helper-operations.mjs host-helper-protocol.mjs production-installation-config.mjs; do
  install_file "$STAGE_ROOT/scripts/$file" "$INSTALL_ROOT/scripts/$file" 0444
done
install_file "$STAGE_ROOT/container/provider-task.mjs" "$INSTALL_ROOT/container/provider-task.mjs" 0444
install_file "$STAGE_ROOT/validate-production-host-helper.mjs" \
  "$INSTALL_ROOT/validate-production-host-helper.mjs" 0555
install_file "$STAGE_ROOT/service-entrypoint.mjs" \
  "$INSTALL_ROOT/service-entrypoint.mjs" 0555
chmod 0555 "$INSTALL_ROOT" "$INSTALL_ROOT/scripts" "$INSTALL_ROOT/container"

if [ "$OS" = Linux ]; then
  install_file "$STAGE_ROOT/repo-assessment-kit-host-helper.service" \
    /etc/systemd/system/repo-assessment-kit-host-helper.service 0444
else
  install_file "$STAGE_ROOT/com.repo-assessment-kit.host-helper.plist" \
    /Library/LaunchDaemons/com.repo-assessment-kit.host-helper.plist 0444
fi

chown 0:"$CLIENT_GID" "$CONFIG"
chmod 0440 "$CONFIG"
chown "$CLIENT_UID":"$CLIENT_GID" "$CLIENT_KEY"
chmod 0600 "$CLIENT_KEY"

verify_installation

printf '%s\n' \
  "host-helper files installed and verified" \
  "service was not started or enabled; activation requires an explicit root operator action"
