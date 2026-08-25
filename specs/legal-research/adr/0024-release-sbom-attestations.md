# ADR 0024: Bind signed release artifacts to SPDX SBOM and build attestations

Status: Format and release integration accepted; signed fork run pending

Date: 2026-08-24

## Decision

Generate the release SBOM only after Electron Builder finishes producing the platform's distributable files. The generator accepts the exact installer paths, hashes their bytes with SHA-256, verifies both packaged license receipts against the current desktop dependency closure and installed evidence-worker tree, and emits:

1. an SPDX 2.3 JSON document that describes every distributable hash;
2. the conservative desktop JavaScript dependency closure;
3. the managed CPython runtime and every installed Python distribution;
4. every packaged model set and the hashes of its installed artifacts; and
5. a checksum file containing the same release subjects.

The release workflow gives that checksum file to the immutable `actions/attest` v4.2.2 revision twice. The first invocation creates GitHub build provenance. The second creates the SBOM attestation. Both attestations therefore name the exact hashes recorded as release packages in the SPDX document; they do not attest the source tree, an unpacked approximation, or a pre-signing artifact.

The SPDX `comment` preserves the source commit and license-policy state. Non-normalized dependency license declarations remain visible in `licenseComments` and are conservatively represented as `NOASSERTION`; the generator does not turn an automated inventory into a legal conclusion. A policy mismatch between the desktop and evidence-worker receipts fails generation.

## Evidence

- Three focused tests prove exact subject hashing, npm/PyPI package URLs, installed model/runtime file relationships, deterministic distributable discovery, and fail-closed policy-state matching.
- A local run against the complete packaged desktop and CPU-only evidence-worker receipts produced an approximately 1.1 MB document with 1,071 packages and 294 hashed installed files.
- That complete document passed the canonical SPDX 2.3 JSON schema with zero validation errors.
- The existing signed Electron release path now requests GitHub's required OIDC and attestation permissions, generates the SBOM after packaging and signature verification, and uses the same subject checksum file for build-provenance and SBOM attestations.
- The attestation action is pinned to commit `1e69f48acb82d1966a394da916b4c1698aa569d6` (`v4.2.2`), rather than a mutable version tag.
- GitHub Actions run 32807494360 passed the new SBOM tests together with all legal TypeScript, packaged worker/OCR, dependency, and full-history secret gates.

## Remaining release gate

This ADR does not claim a signed LegalBuilder release exists. ADR 0025 adds a separate protected, fork-owned release-candidate path because the inherited publisher remains restricted to the upstream repository. Its checked-in policies intentionally block execution until LegalBuilder controls the Apple, Windows, and any applicable Linux signing identities, counsel changes both receipt policies to `approved` with complete review evidence, and the release environment is protected. Then run the workflow against the final signed/notarized installers, download those exact bytes, and independently verify both attestations and platform signatures before publishing them.

Broader upstream-monorepo vulnerability findings still need a reviewed reachability/remediation disposition if those components are deployed beyond the audited legal desktop closure.
