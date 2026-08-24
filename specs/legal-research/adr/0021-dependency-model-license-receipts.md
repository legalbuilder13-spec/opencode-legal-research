# ADR 0021: Ship fail-closed dependency and model license receipts

Status: Automated inventory accepted; counsel approval pending

Date: 2026-08-24

## Decision

Generate two deterministic third-party receipts during every desktop build. `THIRD_PARTY_LICENSES.desktop.json` conservatively walks the desktop, bundled OpenCode server, legal workbench, UI, and Electron dependency closure. It records exact package versions, declared licenses, repository metadata, and the text and hash of available root license and notice files. `THIRD_PARTY_LICENSES.json` travels inside the evidence-worker resource and records the managed Python license, every installed top-level Python distribution, preserved distribution license files, reviewed model sources and licenses, immutable Hugging Face revisions, and hashes of every shipped model artifact.

Missing declarations, missing declared license files, unexpected model revisions, altered OCR weights, stale exceptions, absent receipts, and receipt/manifest hash mismatches fail the build or installed-resource gate. Model revisions and RapidOCR file hashes are repository-reviewed policy, so a mutable upstream default cannot silently enter an installation.

The receipts deliberately state `pending-counsel-review`. A `--require-approved` mode blocks release until that state is changed through review. Automated metadata collection is evidence for counsel; it is not a legal conclusion about compatibility, attribution, training-data rights, patents, trademarks, or commercial redistribution.

## Current evidence

- The desktop closure contains 940 third-party package identities and their available notice text.
- The verified macOS worker contains 104 top-level Python distributions, the managed CPython license, and four model sets; the receipt derives the exact platform-specific closure during each build.
- Docling Heron, Heron ONNX, and TableFormer are locked to observed 40-character Hugging Face revisions and model-card license declarations.
- The four RapidOCR/PaddleOCR Latin-pipeline files are locked to the hashes published by the installed RapidOCR registry. The receipt preserves RapidOCR's statement that Baidu holds the OCR model copyright.
- Two exact-version desktop packages omit license metadata/files in their published archives. Narrow overrides point to their MIT-licensed upstream repositories and remain explicitly pending counsel confirmation; an unused or version-mismatched override fails.
- Unit tests reject missing Python license metadata and modified model artifacts. Managed CPython license discovery covers the Unix `lib/pythonX.Y/LICENSE.txt` and Windows root/install layouts without admitting package-level license files. Runtime discovery rejects a missing or altered worker receipt. The unpacked installation verifier re-derives both receipts from the installed resources.

## Remaining gate

Counsel must review the generated receipts, the two source-repository overrides, all notice/attribution obligations, model and training-data terms, and the scope of the conservative desktop closure. Only then may the policy state become `approved` and the release build use `--require-approved`. The fork also still needs vulnerability, provenance, and secret scanning; this ADR covers license completeness and integrity only.
