# Protected customer-release setup

This setup is performed once by the repository owner. Clients do not perform it.

## 1. Create the protected environment

In GitHub, open **Settings → Environments → New environment** and create:

```text
customer-release
```

Configure:

- at least one required reviewer other than the person starting the workflow;
- deployment branches restricted to `main`; and
- administrator bypass disabled when the organization supports that control.

Do not run the release workflow until these protections are visible in GitHub.

## 2. Create the Ed25519 release authority

Create the key on an approved administrator machine, not in a development container:

```sh
umask 077
mkdir -p generated/release-authority
openssl genpkey \
  -algorithm ED25519 \
  -out generated/release-authority/release-signing-private-key.pem
openssl pkey \
  -in generated/release-authority/release-signing-private-key.pem \
  -pubout \
  -out generated/release-authority/release-signing-public-key.pem
```

The `generated/` directory is ignored by Git. Confirm that the private key is mode `0600`, move an
encrypted recovery copy into approved offline custody, and never commit it.

## 3. Upload the protected secret

With an authenticated GitHub CLI:

```sh
gh secret set \
  --repo huan-ca/repo-assessment-kit \
  --env customer-release \
  RAK_RELEASE_SIGNING_PRIVATE_KEY_PEM \
  < generated/release-authority/release-signing-private-key.pem
```

GitHub secrets cannot be read back. Confirm the offline recovery copy before removing any working
copy.

## 4. Run the protected workflow

Open **Actions → Protected customer release → Run workflow**. Use a short release name such as:

```text
customer-2026-07
```

The workflow:

1. builds Linux and macOS native host-helper payloads;
2. builds and publishes signed multi-architecture Codex, Claude, acquisition, and browser images;
3. generates image SBOMs, GitHub build attestations, and vulnerability reports;
4. blocks on known Critical or High image vulnerabilities;
5. creates the closed release manifest and evidence lock;
6. signs their exact bytes with the protected Ed25519 secret;
7. verifies the finished bundle using the emitted public key; and
8. uploads a checksummed customer-release archive.

Download the workflow artifact only after every protected job is green.

## 5. Host-helper installation remains machine-specific

The bundle contains the installer and native payloads. A trusted administrator must still provision
the machine-specific host-helper configuration, public authorities, client account, and client key,
then verify and activate the service using the [operator runbook](operator-runbook.md). Those
authorities describe the actual client machine and must not be fabricated in CI or copied between
clients.
