# Milestone C12 result: cross-platform live-web/OCR review path

Date: 2026-08-25

Status: Manual matrix built; macOS arm64 candidate passed; Windows/Linux execution and review pending

The existing three-page live-web candidate is now executable through one manual GitHub matrix on macOS arm64, Windows x64, and Linux x64. Each job builds and verifies the relocatable CPU-only worker, captures real public pages through the pinned Electron network boundary, applies structural and visual assertions, performs offline OCR, and retains review evidence without changing the candidate review state.

The cross-platform runner no longer assumes a Unix Electron launcher and skips Unix permission handling on Windows. Linux runs through the hosted runner's virtual display. Workflow input is limited to a short non-sensitive review-batch identifier, and output artifacts expire after 30 days.

Local macOS arm64 revalidation passed all three sources on 2026-08-25 with Electron 42.3.3 / Chromium 148.0.7778.218 and packaged RapidOCR 3.9.2:

| Case                            | Render   | Screenshot bytes | OCR time  | OCR items |
| ------------------------------- | -------: | ---------------: | --------: | --------: |
| `control-example-domain`        | 1,134 ms |           44,232 | 11,978 ms |         2 |
| `cornell-us-constitution-index` | 2,594 ms |        1,321,964 | 13,340 ms |       101 |
| `scotus-opinions-index`         | 1,749 ms |        2,483,892 | 13,037 ms |        25 |

The workflow and expressions pass actionlint and YAML parsing, and workspace typechecking passes. GitHub will expose manual dispatch only after this complete change reaches the fork's default branch. Windows/Linux runs, reviewer adjudication, and corpus expansion remain open.
