# ADR 0011: supervised public-web capture boundary

Status: accepted alpha boundary

Date: 2026-08-24

## Decision

Expose public-URL capture in the legal workbench through a host-owned `WebCaptureService`. Structural mode performs a bounded manual-redirect fetch, archives the response body, records requested/final/canonical URLs, and sends inert HTML to the evidence worker. Strict visual mode requires an injected supervised renderer that returns the final HTML and a PNG/JPEG snapshot; the evidence worker creates both a structural representation and a strict OCR representation under the same immutable source version.

Each representation records the hash of its actual input artifact. The archived HTML remains the source-version content hash, while the rendered screenshot has its own content-addressed blob hash. The source stays partial and support-ineligible until every requested representation completes.

The host accepts only HTTP(S), standard ports, credential-free URLs, bounded redirects, bounded HTML/screenshot sizes, and publicly resolved addresses. Local, private, link-local, and reserved addresses are rejected before fetch or render. Redirect targets and renderer-reported final URLs cross the same check.

## Consequences

- Lawyers can add an ordinary public URL from the Sources screen and receive an inert, reproducible structural representation.
- A strict renderer cannot silently downgrade to HTML-only capture; missing renderer support returns a visible recoverable error.
- ADR 0017 selects and supervises the Electron Chromium already present in the desktop package rather than promoting Playwright or another browser runtime into production dependencies.
- The selected renderer applies request interception, private-network checks, active-channel blocking, ephemeral sessions, and authenticated loopback transport. Production must still pin network connections against DNS rebinding and exercise the reviewed live-web corpus before ING-04 can pass fully.

## Evidence

- `WB-09` proves structural HTML and visual OCR remain attached to one immutable source version with distinct artifact hashes.
- Web-boundary tests prove bounded redirects, canonical metadata, private-address rejection, and visible renderer-unavailable failure.
- Browser verification proves the public-URL UI and live private-network rejection path with no console errors.
