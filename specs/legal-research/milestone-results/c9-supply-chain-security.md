# Milestone C9 result: dependency vulnerability and secret gates

Date: 2026-08-24

Status: Hosted dependency and full-history secret gates passed

The packaged legal desktop's production dependency audit now fails on high or critical npm advisories. The evidence worker's complete frozen production lock fails on any vulnerability reported by the Python audit service. Full-history secret scanning is also part of the legal workflow and uses an immutable action revision.

The initial audit found an outdated Windows packaging peer plus vulnerable `fast-uri` and `js-yaml` resolutions. The peer is now explicitly aligned with Electron Builder 26.15.2, while the two transitive dependencies are locked to their minimum current fixed releases. After resolution, the scoped desktop audit returned clean and the frozen Python closure returned no known vulnerabilities. GitHub Actions run 32761361462 passed the desktop audit, Python audit, and immutable-revision full-history Gitleaks action.

This result is not a clean bill of health for the whole upstream monorepo. Current full-root dependency scanning still reports findings in nonpackaged services and development dependencies. The successor C10 milestone implements and schema-validates the signed-installer SBOM/provenance path, but its production execution still needs fork-owned signing credentials. A release candidate also needs a reviewed reachability/exclusion decision for broader findings.
