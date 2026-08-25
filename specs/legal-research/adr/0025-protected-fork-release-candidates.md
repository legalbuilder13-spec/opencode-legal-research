# ADR 0025: Build fork-owned release candidates behind protected policy gates

Status: Workflow and fail-closed policy records accepted; first candidate blocked on external approvals

Date: 2026-08-25

## Decision

Use a separate, manually dispatched `legal release candidate` workflow for `legalbuilder13-spec/opencode-legal-research`. Do not weaken or repurpose the inherited upstream publish workflow. The fork workflow only accepts an exact semantic version, a typed confirmation, the `legal-research` branch or a `legal-v*` tag, the exact fork repository identity, and an administrator-controlled `LEGAL_RELEASE_ENABLED=true` variable.

Put all platform build jobs behind the `legal-production` GitHub environment. That environment must have required reviewers and restricted deployment branches before enablement. The workflow creates candidates but does not create or publish a GitHub Release.

License approval is represented by two checked-in policy records rather than a mutable workflow input:

- `packages/desktop/dependency-license-policy.json`; and
- `packages/legal-evidence-worker/packaged-model-policy.json`.

An `approved` policy must name the reviewer, an ISO review time, and a durable review-record identifier. Pending records must leave all three fields null. The policy job blocks before the expensive platform matrix unless both records are complete and approved. The final SBOM generator repeats both approval checks against the artifacts' actual receipts and installed worker tree.

For macOS arm64, the protected job imports a Developer ID certificate, packages and notarizes the application, then checks the code signature, Gatekeeper assessment, and stapled DMG ticket. For Windows x64, it uses Azure Trusted Signing and verifies every produced and unpacked executable with Authenticode. Linux x64 packages remain platform-native AppImage/deb/rpm files and receive GitHub build-provenance and SBOM attestations; repository/package-manager signing remains a separate distribution decision.

Every platform also starts the unpacked installed legal workbench and performs real offline OCR through the packaged Python/model tree before generating and attesting the release-candidate SBOM.

## Evidence

- The fork-owned workflow parses as YAML and passes actionlint 1.7.12 with no workflow-specific findings.
- The actionlint release archive matched its published SHA-256 before use.
- Twelve focused packaging-policy/SBOM tests pass, including complete approval evidence, pending-policy blocking, receipt determinism, exact artifact hashing, and model-file relationships.
- The desktop TypeScript project passes after the policy and SBOM changes.
- All external actions in the new workflow are pinned to immutable commit revisions.

## Remaining release gate

The current checked-in policy state is intentionally `pending-counsel-review`, `LEGAL_RELEASE_ENABLED` must remain unset/false, and no signing secrets are present in source. The workflow is currently on `legal-research`, while the fork's default branch is `dev`; GitHub will expose manual dispatch only after the complete reviewed change set reaches the default branch (or a separate reviewed decision changes that default). LegalBuilder must then configure and protect the GitHub environment, obtain counsel approval and durable review records, provision Apple and Azure identities, decide whether/how Linux packages will be repository-signed, and run the first candidate.

After the workflow passes, independently download and verify every candidate, install it on clean supported systems, exercise the complete Electron window-to-answer-restart transaction, and inspect OS trust prompts and updater behavior. Only that later evidence can close the signed-installer gate.
