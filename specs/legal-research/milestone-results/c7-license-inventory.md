# Milestone C7 result: packaged dependency and model license inventory

Date: 2026-08-24

Status: Automated completeness and integrity gates passed; counsel approval pending

The desktop build now produces and ships complete machine-readable license receipts for its conservative JavaScript/Electron dependency closure and its Python/Docling/RapidOCR resource. The receipts include versions, declarations, available notice text, source evidence, immutable revisions, and artifact hashes. Installed-resource verification re-derives both inventories rather than checking only that files exist.

Local macOS verification passed for 940 desktop third-party package identities, 104 top-level Python distributions, managed CPython, three revision-locked Docling model repositories, and the four hash-locked RapidOCR files. The exact Python count is derived independently on each platform. Negative tests prove that missing license metadata, changed model weights, changed receipts, and stale overrides fail closed. Cross-platform tests also recognize the managed CPython license only in approved Unix and Windows runtime layouts.

This milestone does not approve the licenses. Both receipts remain visibly `pending-counsel-review`; the release-only approval mode therefore fails intentionally. Counsel must confirm compatibility, notices, model/training-data rights, and two exact-version source-repository overrides before a release candidate can pass the approval gate.
