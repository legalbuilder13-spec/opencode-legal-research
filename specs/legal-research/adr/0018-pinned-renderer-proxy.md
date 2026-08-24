# ADR 0018: Pin strict-renderer connections through a validating proxy

Status: accepted for alpha integration; reviewed live-web corpus pending

Date: 2026-08-24

## Decision

Give every strict-visual capture its own ephemeral IPv4-loopback HTTP proxy and configure the capture's in-memory Electron session to use that proxy for both HTTP and HTTPS without a direct fallback. The proxy resolves each requested hostname once through the shared public-network validator, rejects the target if any answer is local, private, or reserved, and dials one address from that same validated answer set. Chromium therefore cannot perform a second DNS lookup between validation and connection.

For HTTP, the proxy connects directly to the selected IP while preserving the validated hostname in the `Host` header. For HTTPS, it accepts `CONNECT` only for port 443, opens the tunnel to the selected IP, and leaves TLS hostname and certificate verification end to end between Chromium and the authority. Redirects and passive subresources repeat validation and pinning independently.

The proxy permits no request bodies, upgrades, non-GET/HEAD HTTP requests, nonstandard ports, private targets, or direct failover. It strips hop-by-hop proxy headers, applies 30-second socket timeouts, caps a plain HTTP response at 25 MB, caps a tunnel and the aggregate capture at 128 MB, tracks all sockets, and destroys them when the capture ends. Electron closes pooled session connections before and after each use.

## Evidence

- Deterministic proxy tests prove a validated public address is the exact address passed to the HTTPS tunnel dialer.
- A rebinding fixture returns a public answer for its first tunnel and a private answer for its next lookup; the proxy permits the first connection, rejects the second before dialing, and also rejects a subsequent plain HTTP request.
- Existing policy tests still reject private URLs, writes, frames, and active exfiltration channels before the proxy boundary.
- Real hidden Electron 42.3.3 Chromium captures succeed through the proxy for both `https://example.com/` and `http://example.com/`, preserving the expected HTML and a 44,232-byte PNG.
- The desktop CI gate now runs the policy, pinning-proxy, authenticated-renderer-service, compiled-workbench, and packaging tests together.

## Consequences and remaining gates

- The prior DNS time-of-check/time-of-use blocker is closed for renderer HTTP(S) traffic: the proxy connects to the address produced by the validating lookup rather than asking Chromium or the operating system to resolve the authority again.
- The proxy is an ephemeral unauthenticated loopback listener because Chromium fixed-proxy configuration does not carry the renderer service's bearer token. It exists only for one capture, can dial only validated public targets, and is closed with all tracked sockets afterward. The live security corpus must still exercise hostile local clients and port-race/denial scenarios.
- ING-04 remains partial until reviewed live-web, subresource, long-page, redirect, cookie-banner, reserved-address, and structural/visual/OCR fixtures pass on every supported platform.
- This decision does not provide the separate OS sandbox still required around the document/OCR worker.
