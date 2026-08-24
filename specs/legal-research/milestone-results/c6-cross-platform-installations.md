# Milestone C6 result: cross-platform unpacked legal installations

Date: 2026-08-24

Status: Linux x64, macOS arm64, and Windows x64 unpacked gates passed; signed installers pending

## Implemented gate

Electron Builder now includes the compiled legal workbench and relocatable evidence worker exactly once as external resources. They are excluded from `app.asar`, preventing the approximately 2.0 GB Python/Docling/RapidOCR tree from being duplicated inside an installation.

The worker dependency handoff uses `pylock.toml`, preserving exact package indexes, artifact URLs, and hashes into installation. PyTorch and TorchVision are pinned to the explicit CPU-only index on all platforms; the packaged lock excludes CUDA, NVIDIA, and Triton dependencies.

The platform-neutral verifier runs only after Electron assembly. It validates contained manifest paths, starts and stops the workbench from the installed resources directory, requires the health contract to report packaged evidence readiness, and runs a real offline strict-visual RapidOCR ingestion from the installed Python and model paths.

## Verification

- Linux x64 workflow run 32754039748 passed the unpacked Electron, workbench, and OCR gate.
- Cross-platform workflow run 32756781203 passed on standard GitHub-hosted macOS arm64 and Windows x64 runners.
- Every platform built its own exact managed Python distribution and packaged model tree rather than copying a foreign-platform worker.
- The OCR verifier returned a RapidOCR result with non-empty evidence items and one canonical page.
- Windows test packaging explicitly bypassed certificate signing; the production publish workflow's signing path was not weakened.

## Remaining release gate

These results prove resource placement and native runtime compatibility, not actual installer or trust-chain behavior. Fork-owned Apple signing/notarization and Windows signing credentials are still required, followed by clean-machine installation and restart tests for the signed DMG/ZIP/NSIS artifacts. AppImage, deb, rpm, Intel macOS, and any retained ARM64 Windows/Linux targets also require installation coverage. Updater behavior, OS trust prompts, dependency/model license review, and the complete signed Electron window-to-answer restart remain open.
