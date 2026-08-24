# ADR 0007: Ship the evidence loop as a separable local workbench

Date: 2026-08-23

Status: accepted for alpha integration

## Decision

Assemble matter management, materialization, retrieval, subscription status, citation review, and provenance export in a new `@legalbuilder/legal-workbench` workspace package before altering the primary OpenCode application shell.

The package uses the same Bun/TypeScript workspace and imports the fork-owned adapters directly. It persists legal-research state locally and exposes a small HTTP interface plus a responsive browser UI. It deliberately does not claim that its deterministic citation demo is a live model-generated legal answer.

## Why

The legal evidence loop crosses model protocol, local persistence, OCR, retrieval, citation finalization, and browser interaction. A separable surface provides a testable integration seam without coupling the alpha data contracts to the main app's session schema or requiring an incomplete rebrand across the existing localization surface.

## Consequences

- The fork now has a usable research and evidence-review application.
- Matter/source/retrieval persistence can be tested without starting the main OpenCode server.
- Subscription entitlement is visible without an API key.
- The workbench can advance independently while shell navigation and production sidecar packaging remain explicit.

## Revisit

ADR 0010 adds the primary-shell route after the answer transaction, subscription synthesis, recovery UX, and export were unified. Replace the alpha sidecar launch with supervised desktop packaging only after restart, installer, and localization gates pass.
