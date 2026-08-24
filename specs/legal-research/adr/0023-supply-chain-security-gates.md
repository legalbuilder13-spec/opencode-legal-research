# ADR 0023: Fail legal-product builds on known vulnerabilities and committed secrets

Status: Dependency gates accepted; first hosted secret scan pending

Date: 2026-08-24

## Decision

Treat the legal desktop and evidence worker as explicit release dependency closures rather than claiming that every service and development tool in the upstream OpenCode monorepo ships in the legal desktop. Every legal workflow run now:

1. runs Bun's production audit from the desktop workspace and fails on high or critical advisories;
2. exports the evidence worker's frozen production lock and audits every pinned Python package with `pip-audit` 2.10.1; and
3. scans the full Git history for committed secrets with the immutable Gitleaks v3.0.0 action revision.

The Windows Squirrel packaging peer is now an explicit exact-version development dependency, preventing Bun from retaining an older vulnerable peer closure. Root overrides hold `fast-uri` at 3.1.5 and `js-yaml` at 4.3.1, the minimum releases that cleared the current desktop audit. The full typecheck, legal tests, packaging tests, and cross-platform installation matrix must detect compatibility regressions from those overrides.

Advisory databases change after a commit is made, so a stored one-time report is not a release gate. CI queries current npm and Python advisory services on every relevant change. A network or scanner failure is a failed gate, not a clean result.

## Current evidence

- The local desktop production audit reports no high or critical findings after the three dependency corrections.
- The worker's frozen 104-distribution production closure reports no known Python vulnerabilities.
- The broader root-monorepo audit still reports high and critical findings in upstream services and development dependencies outside the scoped legal desktop audit. Those findings remain visible and cannot be described as remediated by this ADR.
- The secret workflow is pinned by commit hash and checks full history; its first hosted result remains pending until this change runs in GitHub Actions.

## Remaining gate

Confirm the hosted secret scan, keep both dependency scans green, produce a machine-readable SBOM from the actual signed installation, bind it to build provenance/attestation, and review every broader monorepo finding for reachability or remediation before any component beyond the audited legal desktop closure is deployed.
