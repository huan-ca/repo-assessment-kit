import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../../../", import.meta.url);
const installer = await readFile(
  new URL("scripts/install-production-host-helper.sh", root),
  "utf8",
);
const systemd = await readFile(
  new URL("container/runtime/install/repo-assessment-kit-host-helper.service", root),
  "utf8",
);
const launchd = await readFile(
  new URL("container/runtime/install/com.repo-assessment-kit.host-helper.plist", root),
  "utf8",
);
const validator = await readFile(
  new URL("container/runtime/install/validate-production-host-helper.mjs", root),
  "utf8",
);

test("installer exposes only explicit install, verify, and dry-run modes", () => {
  assert.match(installer, /install\|verify\|--dry-run/);
  assert.doesNotMatch(installer, /uninstall|eval|sh -c|bash -c/);
  assert.match(installer, /id -u.*-eq 0/);
  assert.match(installer, /Linux\)[\s\S]*PLATFORM=linux[\s\S]*PAYLOAD_PLATFORM=linux/);
  assert.match(installer, /Darwin\)[\s\S]*PLATFORM=darwin[\s\S]*PAYLOAD_PLATFORM=macos/);
  assert.match(installer, /payload\/\$PAYLOAD_PLATFORM-\$ARCHITECTURE/);
  assert.match(installer, /CLIENT_UID=62345/);
  assert.match(installer, /CLIENT_GID=62345/);
  assert.match(installer, /NODE_VERSION=v24\.4\.1/);
  assert.match(installer, /\/nonexistent.*\/usr\/sbin\/nologin/);
  assert.match(installer, /id -G rak-client/);
  assert.match(installer, /NFSHomeDirectory.*\/var\/empty/);
  assert.match(installer, /UserShell.*\/usr\/bin\/false/);
  assert.match(installer, /GroupMembership/);
  assert.match(installer, /another Linux account uses the dedicated client primary group/);
  assert.match(installer, /another macOS account uses the dedicated client primary group/);
  assert.match(installer, /group has supplemental members/);
  assert.doesNotMatch(
    installer,
    /systemctl enable|systemctl start|launchctl load|launchctl bootstrap/,
  );
});

test("service definitions have fixed entrypoint and no caller-controlled arguments", () => {
  const fixed =
    "/usr/local/libexec/repo-assessment-kit/node /usr/local/libexec/repo-assessment-kit/service-entrypoint.mjs";
  assert.match(systemd, new RegExp(`ExecStart=${fixed}`));
  assert.match(systemd, /ExecStartPre=.*validate-production-host-helper\.mjs/);
  assert.match(systemd, /User=root/);
  assert.doesNotMatch(systemd, /EnvironmentFile|%[iInN]|\$\{/);
  assert.ok(
    launchd.includes(
      "<string>/usr/local/libexec/repo-assessment-kit/service-entrypoint.mjs</string>",
    ),
  );
  assert.match(launchd, /<key>UserName<\/key>\s*<string>root<\/string>/);
  assert.match(launchd, /<key>RunAtLoad<\/key>\s*<false\/>/);
});

test("pre-start validation binds production identity and refuses stale sockets", () => {
  assert.match(validator, /loadProductionInstallationConfig/);
  assert.match(validator, /EXPECTED_UID = 62345/);
  assert.match(validator, /EXPECTED_GID = 62345/);
  assert.match(validator, /EXPECTED_NODE_VERSION = "v24\.4\.1"/);
  assert.match(validator, /verified-host-helper\.txt/);
  assert.doesNotMatch(validator, /node\.sha256/);
  assert.match(validator, /socket already exists/);
  assert.doesNotMatch(validator, /unlink|rm\(|fake|fixture/);
});

test("pre-start validation binds the peer verifier bytes to production configuration", () => {
  assert.match(validator, /actualPeerVerifierDigest/);
  assert.match(validator, /installation\.config\.peerCredentialVerifier\.sha256/);
  assert.match(validator, /native peer verifier digest does not match production configuration/);
});

test("verify rejects drift in every installed release-package helper file", () => {
  assert.match(installer, /require_authorized_file\(\)/);
  assert.match(installer, /verify_payload_tree\(\)/);
  for (const file of [
    "production-host-helper.mjs",
    "host-helper-service.mjs",
    "host-helper-journal.mjs",
    "host-helper-operations.mjs",
    "host-helper-protocol.mjs",
    "production-installation-config.mjs",
    "provider-task.mjs",
    "validate-production-host-helper.mjs",
    "service-entrypoint.mjs",
    "repo-assessment-kit-host-helper.service",
    "com.repo-assessment-kit.host-helper.plist",
  ]) {
    assert.ok(installer.includes(file), `installer does not bind ${file}`);
  }
  assert.doesNotMatch(installer, /cmp -s|node\.sha256/);
});

test("signed authority and staged hashes precede mutation and payload execution", () => {
  const installBranch = installer.slice(installer.lastIndexOf("preverify_release_package"));
  assert.ok(
    installBranch.indexOf("preverify_release_package") <
      installBranch.indexOf("stage_release_payload"),
  );
  assert.ok(
    installBranch.indexOf("stage_release_payload") < installBranch.indexOf("create_identity"),
  );
  assert.ok(
    installBranch.indexOf("verify_payload_tree") < installBranch.indexOf("create_identity"),
  );
  assert.doesNotMatch(installer, /"\$NODE_PAYLOAD" --version/);
  assert.match(installer, /install_file "\$STAGE_ROOT\/node" "\$INSTALL_ROOT\/node"/);
  assert.match(
    installer,
    /mktemp -d \/var\/lib\/repo-assessment-kit\/release\/\.host-helper-stage/,
  );
});

test("systemd applies compatible fixed host-helper hardening", () => {
  for (const directive of [
    "ProtectSystem=full",
    "NoNewPrivileges=true",
    "ProtectHostname=true",
    "ProtectClock=true",
    "RestrictSUIDSGID=true",
    "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6 AF_NETLINK",
    "SystemCallArchitectures=native",
  ]) {
    assert.ok(systemd.includes(directive), `missing ${directive}`);
  }
  assert.doesNotMatch(systemd, /PrivateDevices|ProtectProc/);
});
