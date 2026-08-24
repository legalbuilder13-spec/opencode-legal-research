# Milestone C3 progress: public-web capture

Status: structural product flow passed; strict renderer contract passed; packaged renderer pending

Date: 2026-08-24

ADR: [`../adr/0011-supervised-web-capture.md`](../adr/0011-supervised-web-capture.md)

## Result

The Sources screen now captures public URLs rather than leaving SRC-02 as a storage-only capability. Structural mode archives bounded response bytes and URL metadata, parses HTML inertly, and exposes only persisted passages. Strict mode is fail-closed behind a supervised-renderer contract and, when provided, stores HTML plus a separately hashed screenshot, canonical page image, OCR text, and exact regions under one immutable source version.

## Verification

- `WB-09`: one strict web source, two representations, distinct input artifact hashes, one canonical source identity.
- Public-web tests: bounded public redirects, canonical URL extraction, nonstandard-port/credential/private-address rejection, and explicit 503 renderer-unavailable state.
- Workbench suite: 16 passing tests, 97 assertions.
- Browser: URL controls render with accessible names; a loopback URL is rejected in the live status region; no browser warnings or errors.

## Remaining gate

ING-04 remains partial until the desktop/installer bundles a supervised renderer and a reviewed live-web corpus verifies rendered snapshots, subresource policy, DNS-rebinding resistance, OCR, and structural/visual agreement.
