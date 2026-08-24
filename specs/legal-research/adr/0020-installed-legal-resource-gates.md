# ADR 0020: Verify legal resources from unpacked Electron applications

Status: Linux x64, macOS arm64, and Windows x64 accepted

Date: 2026-08-24

## Decision

Treat a successful standalone sidecar build as insufficient installer evidence. After Electron Builder assembles an unpacked application, run a platform-neutral verifier against that application's installed resources directory. The verifier requires the compiled legal workbench and a root-contained packaged evidence-worker manifest, starts and stops the installed workbench, requires its health contract to report the evidence worker as ready, and performs a real offline strict-visual RapidOCR ingestion through the installed Python/model tree.

Exclude `legal-workbench*` and `legal-evidence-worker/**` from the application archive and include them only through Electron Builder's external resources. This prevents duplicating the approximately 2.0 GB worker inside both `app.asar` and the installed resources directory.

The ordinary legal-research workflow runs the unpacked gate on Linux x64. A manually dispatched matrix uses standard GitHub-hosted macOS arm64 and Windows x64 runners. The Windows matrix explicitly skips certificate signing; production signing remains fail-closed in the existing publish workflow.

## Evidence

- Configuration tests require both legal resources as `extraResources` and exclude them from the application archive.
- A local macOS arm64 installed-resource simulation starts the compiled workbench and returns three RapidOCR 3.9.2 items plus one canonical page from the packaged resource.
- Linux x64 workflow run 32754039748 builds the unpacked Electron application and passes the installed workbench/discovery/OCR verifier.
- Cross-platform workflow run 32756781203 passes the same native resource build, Electron assembly, installed workbench lifecycle, discovery, and offline OCR gate on standard GitHub-hosted macOS arm64 and Windows x64 runners.
- The Windows gate also proves the managed `python.exe` root layout, bounded recovery from Bun's patched-package cache race, and an explicitly unsigned test build. The macOS gate uses the same 4 GB Node build heap as the upstream release workflow.

## Remaining gates

- Add Intel macOS and ARM64 Windows/Linux coverage if those architectures remain release targets.
- Obtain fork-owned Apple and Windows signing credentials, then install and smoke actual signed/notarized DMG/ZIP/NSIS/AppImage/deb/rpm artifacts. An unpacked unsigned gate does not prove signing, installer UX, OS trust prompts, updater behavior, or clean-machine dependencies.
