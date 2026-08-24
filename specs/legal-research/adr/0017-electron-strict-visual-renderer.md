# ADR 0017: Reuse isolated Electron Chromium for strict-visual web evidence

Status: accepted for alpha integration; production security gate partial

Date: 2026-08-24

## Decision

Use the desktop application's already-shipped Electron Chromium as the strict-visual web renderer instead of adding and packaging a second Playwright/Chromium runtime. After Electron is ready, the main process starts a renderer service on an ephemeral IPv4 loopback port with a random memory-only bearer token and passes that endpoint/token only to the supervised legal workbench.

Each capture uses a new in-memory Electron session and hidden sandboxed `BrowserWindow`. Node integration, devtools, permissions, popups, webviews, downloads, persistent storage, and insecure mixed content are disabled. The session is destroyed and its cache/storage are cleared after capture.

The renderer permits bounded GET/HEAD main-document, script, style, image, and font requests to public HTTP(S) targets. It blocks local/private/reserved targets, credentials, nonstandard ports, writes, subframes, XHR, WebSockets, ping/CSP reports, media, objects, downloads, and more than 200 requests. Every HTTP(S) target is resolved through the shared public-network validator before Chromium sends it; private actual IPs observed on redirects fail the capture. Declared per-resource size, total HTML, screenshot bytes, time, width, height, and pixels are bounded.

After a successful 2xx load and short layout-settling interval, the renderer returns the final URL, serialized DOM HTML, and a full-page PNG through the authenticated loopback contract. The workbench archives HTML and PNG separately, parses the HTML structurally, sends the PNG through strict-visual OCR, and attaches both immutable representations to one source version.

## Evidence

- Network-policy tests allow bounded passive public assets while rejecting private targets, frames, active exfiltration channels, and non-GET/HEAD methods.
- Loopback-service tests reject missing bearer tokens and validate the versioned capture response.
- Workbench tests accept only a healthy IPv4-loopback renderer contract and reject remote endpoints.
- A compiled workbench, authenticated renderer fixture, and relocated packaged Docling/RapidOCR worker completed one strict-visual web transaction in approximately 13 seconds.
- A real hidden Electron 42.3.3 Chromium capture of `https://example.com/` preserved the expected HTML and produced a 44,232-byte PNG.
- No new external browser dependency or browser binary was added.

## Consequences and remaining gates

- Packaged desktop runs advertise strict-visual URL capture as ready when the local renderer service passes health checks. A standalone workbench without Electron still fails closed and leaves structural capture available.
- Blocking frames and active network APIs reduces fidelity for JavaScript-heavy authorities. The UI must continue to preserve structural HTML and expose capture failures rather than implying completeness.
- The current DNS preflight and redirect-IP check do not cryptographically pin Chromium's connection to the address observed by Node. A local pinned proxy or equivalent connection-level control plus a DNS-rebinding corpus remains a production blocker.
- The alpha produces one bounded full-page PNG rather than a paginated PDF rendition. Reviewed long-page, responsive-layout, cookie-banner, print-style, and accessibility fixtures remain open.
- The live-web corpus must measure subresource exclusions, final-URL accuracy, structural/visual agreement, OCR quality, time, and memory on every supported platform before ING-04 can be marked fully passed.
