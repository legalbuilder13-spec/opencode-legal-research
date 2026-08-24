# Milestone C3 progress: public-web capture

Status: structural product flow passed; packaged strict-renderer alpha transaction passed; production security gate partial

Date: 2026-08-24

ADR: [`../adr/0011-supervised-web-capture.md`](../adr/0011-supervised-web-capture.md)

## Result

The Sources screen now captures public URLs rather than leaving SRC-02 as a storage-only capability. Structural mode archives bounded response bytes and URL metadata, parses HTML inertly, and exposes only persisted passages. Strict mode is fail-closed behind a supervised-renderer contract and, when provided, stores HTML plus a separately hashed screenshot, canonical page image, OCR text, and exact regions under one immutable source version.

## Verification

- `WB-09`: one strict web source, two representations, distinct input artifact hashes, one canonical source identity.
- Public-web tests: bounded public redirects, canonical URL extraction, nonstandard-port/credential/private-address rejection, and explicit 503 renderer-unavailable state.
- Workbench suite: 16 passing tests, 97 assertions.
- Browser: URL controls render with accessible names; a loopback URL is rejected in the live status region; no browser warnings or errors.

## Renderer follow-on and remaining gate

ADR 0017 supervises the desktop's isolated Electron Chromium over an authenticated loopback contract, and ADR 0018 pins each HTTP(S) connection through a validating proxy. Real HTTP/HTTPS HTML/PNG captures, deterministic private rebinding rejection, and the compiled renderer-to-packaged-OCR transaction pass. ING-04 remains partial until a reviewed live-web corpus verifies rendered snapshots, subresource exclusions, reserved-address coverage, OCR, structural/visual agreement, long pages, and supported-platform behavior.
