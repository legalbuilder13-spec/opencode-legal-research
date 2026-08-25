# Milestone C11 result: protected fork release-candidate path

Date: 2026-08-25

Status: Fail-closed workflow passed static and local gates; execution pending external approvals

The fork now has its own manually dispatched release-candidate workflow instead of relying on the inherited publisher, whose jobs are restricted to `anomalyco/opencode`. The workflow is limited to the LegalBuilder fork and release branch/tags, requires an exact version and typed confirmation, honors an administrator-controlled enablement variable, and puts all platform builds behind a `legal-production` environment.

Both license inventories now derive their review status from checked-in policy records. An approval is structurally invalid without a reviewer, timestamp, and durable review-record reference. The early policy job and final artifact-level SBOM generator independently enforce approval. The committed state remains pending and therefore blocks release as intended.

The protected matrix defines macOS arm64 signing/notarization, Windows x64 Azure Trusted Signing, and Linux x64 platform-native packaging. Each job builds the offline OCR worker, runs a real installed-resource OCR smoke, verifies available platform signatures, generates the approved SPDX SBOM, creates build-provenance and SBOM attestations, and retains the candidate for independent review without publishing a release.

Local verification passed 12 focused policy/license/SBOM tests and desktop typechecking. YAML parsing passed, and actionlint 1.7.12 reported no findings in the new workflow. The downloaded validator matched its published SHA-256.

No production candidate was built. The workflow must first reach the fork's current default branch (`dev`) through normal review before GitHub exposes manual dispatch. Counsel approval, protected-environment configuration, Apple/Windows signing identities, the Linux distribution-signing decision, and clean-machine signed-installer testing remain external gates.
