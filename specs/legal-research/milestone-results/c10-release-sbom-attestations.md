# Milestone C10 result: release SBOM and provenance integration

Date: 2026-08-24

Status: SBOM format and signed-build integration passed; production attestation pending credentials

The legal desktop now has a purpose-built SPDX 2.3 release generator. It verifies the two packaged license receipts, records exact distributable SHA-256 hashes, inventories the desktop, managed Python, Python packages, and model sets, and preserves the installed worker's model and license-file hashes. It emits the same subject list used by GitHub's provenance and SBOM attestation steps.

The focused generator suite passed three tests. A complete local receipt run emitted 1,071 package records and 294 installed-file hash records in approximately 1.1 MB, below the attestation action's 16 MB SBOM limit. The document passed the official SPDX 2.3 JSON schema with zero errors. No signed installer was substituted with the local test subject, and the result is not represented as production attestation evidence.

GitHub Actions run 32807494360 then passed the SBOM tests in the hosted legal TypeScript job, plus the packaged Linux worker/OCR installation, current dependency audits, and full-history secret scan.

The signed Electron packaging path now generates and attests only after platform packaging and Windows signature verification. GitHub's unified attestation action is pinned to an immutable v4.2.2 commit and creates separate build-provenance and SBOM attestations over the same checksum file.

## Remaining release gate

ADR 0025 now supplies the fork-owned protected candidate workflow, but its checked-in policies intentionally block execution. Counsel must approve the dependency/model receipts and LegalBuilder must configure the protected environment and signing identities. After those external prerequisites exist, build the final signed/notarized artifacts, run the attestations, and independently verify the downloaded bytes, platform signatures, SBOM attestation, and build provenance. Until that succeeds, signed/notarized installer packaging remains pending.
