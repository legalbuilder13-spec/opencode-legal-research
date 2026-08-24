# ADR 0006: CourtListener case-law adapter

Status: accepted for alpha connector
Date: 2026-08-23

## Decision

Use CourtListener REST API v4 as the first public case-law connector. Require token authentication for programmatic product use, send an explicit JSON `Accept` header, respect `Retry-After`, and expose authentication and throttling as distinct recoverable errors.

Treat search results and highlighted snippets as discovery leads only. A result becomes support-eligible only after the adapter fetches the cluster, docket, court, and every selected full opinion record; stores a raw immutable API envelope; parses `html_with_citations` (preferred by CourtListener) or the available plain-text fallback; persists passages; and attaches the CourtListener cluster/opinion identity and legal metadata.

Keep publication/precedential metadata separate from legal treatment. Citation-graph edges are labeled `Eyecite-derived`, name CourtListener as their source, disclose incomplete parallel-citation coverage, and always return `legalTreatment: not-evaluated`.

## Rationale and current contract

CourtListener's current documentation describes clusters as groups of opinions and opinions as the objects containing decision text. It recommends `html_with_citations` over `plain_text`, uses cluster IDs in public opinion URLs, and exposes case-law search through `/api/rest/v4/search/`. The search API documents snippets as partial display content, not full-source records.

The documented default authenticated limits are 5 requests/minute, 50/hour, and 125/day on rolling windows. The adapter therefore uses bounded requests, surfaces 429 timing, and does not poll.

## Security and provenance

- Followed API resource links must remain on the configured CourtListener origin.
- Tokens are used only in the `Authorization: Token …` request header and are not persisted by the core.
- Search-query egress is disclosed before use.
- HTML is converted as inert text; script and style content are removed and never executed.
- Raw cluster, docket, court, and opinion objects are preserved together before normalized passages become model-visible.

## Consequences

- Search can be fast while verified support still requires full materialization.
- One opinion acquisition consumes multiple rate-limited API calls and should be cached by immutable source version.
- CourtListener coverage and citation graphs are useful but cannot be marketed as comprehensive or equivalent to an editorial citator.
- The first adapter parses structured CourtListener records; it does not OCR JSON. Downloaded/renderable opinion files still pass through the evidence worker when strict visual evidence is requested.

## Sources

- [CourtListener REST API v4.7 overview](https://wiki.free.law/c/courtlistener/help/api/rest/v4/rest-api-v47)
- [CourtListener case-law API](https://wiki.free.law/c/courtlistener/help/api/rest/v4/case-law)
- [CourtListener legal search API](https://wiki.free.law/c/courtlistener/help/api/rest/v4/search)
- [CourtListener citation graph API](https://wiki.free.law/c/courtlistener/help/api/rest/v4/citations)

## Re-evaluation triggers

Revalidate the adapter whenever CourtListener changes its major API version, search result fields, opinion-text recommendation, authentication scheme, or rate-limit contract.
