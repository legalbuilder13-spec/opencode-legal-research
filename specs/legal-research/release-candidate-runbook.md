# LegalBuilder release-candidate runbook

Status: setup instructions; do not enable until the listed approvals exist

The `legal release candidate` workflow builds review artifacts. It does not publish a GitHub Release.

## 1. Record legal approval

Counsel must review the generated desktop dependency receipt, Python dependencies, packaged model sources/terms, notice obligations, and the two exact-version dependency overrides. Store the signed or otherwise durable review record in the organization's approved system.

In one reviewed pull request, update both policy files from `pending-counsel-review` to `approved` and fill:

- `reviewedBy` — the reviewing person or accountable legal function;
- `reviewedAt` — an ISO 8601 UTC timestamp; and
- `reviewRecord` — a durable internal record identifier or URL that contains no secret.

Do not put privileged legal advice or credentials in either JSON file.

## 2. Protect the GitHub environment

Create a `legal-production` environment in `legalbuilder13-spec/opencode-legal-research` with:

- required independent reviewers;
- deployment branches limited to `legal-research` and approved `legal-v*` tags;
- no administrator bypass for ordinary candidate runs; and
- the shortest practical secret access scope.

Add these Apple environment secrets:

- `APPLE_CERTIFICATE`;
- `APPLE_CERTIFICATE_PASSWORD`;
- `APPLE_API_KEY_CONTENT`;
- `APPLE_API_KEY_ID`; and
- `APPLE_API_ISSUER`.

Add these Azure Trusted Signing environment secrets:

- `AZURE_CLIENT_ID`;
- `AZURE_TENANT_ID`;
- `AZURE_SUBSCRIPTION_ID`;
- `AZURE_TRUSTED_SIGNING_ACCOUNT_NAME`;
- `AZURE_TRUSTED_SIGNING_CERTIFICATE_PROFILE`; and
- `AZURE_TRUSTED_SIGNING_ENDPOINT`.

Use workload identity/federation and least-privilege roles. Do not add signing material to repository files or ordinary Actions logs.

## 3. Enable and run one candidate

Only after the policy commit and environment protections are merged, set the repository variable `LEGAL_RELEASE_ENABLED` to `true`.

From GitHub Actions, choose `legal release candidate`, select `legal-research` or an approved `legal-v*` tag, enter the exact version, and type `release-candidate`. Approve the protected environment only after checking the source commit and policy records.

The run should produce separate 14-day artifacts for macOS arm64, Windows x64, and Linux x64. It should not create a release or change a tag.

Set `LEGAL_RELEASE_ENABLED` back to `false` after the intended candidate window unless continuous release-candidate operation has been separately approved.

## 4. Independently verify downloaded bytes

For each downloaded distributable, verify both GitHub attestations against this repository:

```text
gh attestation verify PATH_TO_ARTIFACT --repo legalbuilder13-spec/opencode-legal-research
```

Compare its SHA-256 with `legal-release.subjects.sha256` and confirm the matching package in `legal-release.spdx.json`. Inspect that the SBOM comment names the intended commit and reports `approved`.

Separately verify macOS Developer ID/notarization and Windows Authenticode identities using clean systems outside the build runner. Decide and document the Linux repository/package signing mechanism before distributing deb/rpm packages through a package repository.

## 5. Complete the release gate

Install each retained format on a clean supported system. Exercise first launch, ChatGPT subscription sign-in, matter creation, ingestion/OCR, research, exact citation opening, export, process termination, restart, and reopening the same answer/citations. Record OS trust prompts, updater behavior, failures, artifact hashes, and reviewer decisions.

Do not promote the candidate if any artifact, signature, attestation, installed sidecar, OCR transaction, citation identity, or restart check fails.
