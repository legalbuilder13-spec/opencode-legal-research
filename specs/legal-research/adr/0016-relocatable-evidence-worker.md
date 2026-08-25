# ADR 0016: Package a relocatable offline evidence worker

Status: accepted for alpha packaging

Date: 2026-08-24

## Decision

Build the desktop evidence worker as a manifest-driven Electron resource rather than shipping the repository virtual environment. The build uses the exact Python version in `.python-version`, installs Astral's managed `python-build-standalone` distribution, exports the frozen `uv.lock` to a hash- and URL-bearing `pylock.toml`, synchronizes that lock directly into the Python prefix, copies the worker package, and prefetches the Docling layout/table and RapidOCR model artifacts.

The packaged OCR backend is RapidOCR 3.9.2 on the pinned PyTorch CPU backend with its Latin-script model. PyTorch and TorchVision are direct exact-version constraints resolved only from PyTorch's explicit CPU index on every platform. The lock contains no CUDA, NVIDIA, or Triton package, because packaged OCR has no GPU execution path. English and supported Latin-script hints normalize to that single model. The development `.venv` remains a Tesseract fallback and is never mistaken for a packaged resource.

`runtime-manifest.json` records the relative interpreter and package paths, exact Python version, platform/architecture, OCR engine/backend/languages, frozen lock hash, and a deterministic model-tree hash. The workbench accepts only contained relative manifest paths and complete local artifacts. It starts packaged inference with Hugging Face and Transformers offline flags, an environment allowlist, and the existing process/output/time limits. Unsupported languages fail visibly; the worker never downloads a missing model while processing a legal source.

Electron Builder includes `legal-evidence-worker/**`. Release prebuilds create that resource when `LEGAL_BUNDLE_EVIDENCE_WORKER=1`, and the desktop supervisor points the compiled workbench at the installed resource directory.

## Evidence

- A macOS arm64 resource remained functional after its entire 2.0 GB directory was copied to a different path.
- The relocated runtime used only its bundled model directory to OCR the scanned-image fixture, reporting `rapidocr-3.9.2`, three provenance-bearing items, and one hashed canonical page.
- The resource contains a 1.4 GB managed Python/locked package prefix and approximately 699 MB of Docling/RapidOCR artifacts before installer compression.
- The frozen cross-platform lock contains 109 package records and no CUDA/NVIDIA/Triton packages; the macOS arm64 resource installed 104 top-level distributions and reported `torch.cuda.is_available() == false`.
- Manifest-discovery tests reject escaping paths, missing models, unsupported identity, and incomplete packages.
- Process-boundary tests prove packaged model paths/offline flags cross into the worker while application and connector credentials do not.
- CI builds the complete Linux x64 resource, runs the worker suite with its packaged Python, and runs a real offline RapidOCR smoke ingestion.

## Consequences and open gates

- This removes system Python, Tesseract, and first-run model-download requirements from packaged English/Latin-script ingestion.
- The resource materially increases installer size and build time. Size reduction is a later optimization and must not remove models required by the proven offline path.
- Linux x64, macOS arm64, and Windows x64 have clean-runner unpacked-installation evidence. Signed/notarized installer smoke tests and any additional retained architectures remain open.
- Latin-script OCR is the packaged alpha scope. Additional scripts require explicit model inventory, reviewed fixtures, and manifest changes.
- Dependency/model licenses and notices remain a release audit even though the frozen requirements, lockfile, Python distribution license files, and model files are preserved in the resource.
- ADR 0019 adds Linux address-space/process ceilings while retaining portable CPU/file/descriptor limits on macOS. Enforceable macOS/Windows memory/process-tree containment plus network and filesystem isolation remain required before production release.
