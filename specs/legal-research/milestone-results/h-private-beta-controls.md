# Private-beta P1 controls

Status: synthetic product gates passed

Date: 2026-08-24

## Result

The workbench now completes the locally testable P1 controls in the PRD:

- explicit ChatGPT account logout and device-code sign-in preserve local matters and evidence;
- readable Markdown footnotes resolve to the same immutable evidence as the JSON sidecar;
- generic connector text and text resources cross the materialization boundary, excluded content is logged, and unparsed binary resources remain visibly partial;
- CourtListener source cards show court, jurisdiction, citation, decision date, precedential status, metadata provider, and the matter research-as-of date;
- CourtListener citation-graph output remains explicitly derived and not an editorial treatment judgment; and
- matter local-only mode blocks ChatGPT drafting before context construction.

## Acceptance evidence

- `WB-11` readable multi-passage provenance export.
- `WB-12` account switching with matter/evidence preservation.
- Core `SRC-04/SRC-08` materialization test covering text, linked text, a partial linked binary, and explicitly excluded active content.
- `WB-08` CourtListener acquisition and legal-metadata assertions.
- Core `VER-08` derived citation-graph labeling test.
- `WB-10` matter local-only egress block.

## Boundary

These are deterministic fixture gates. Live account-expiry/cancellation states, a live CourtListener token, attorney adjudication, packaged renderer/sidecar dependencies, desktop installers, and OS-level worker sandboxing remain outside this result.
