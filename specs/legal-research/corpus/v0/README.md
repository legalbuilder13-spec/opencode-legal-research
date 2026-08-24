# Evaluation corpus v0

Status: synthetic scaffold; not attorney reviewed and not a release corpus

This directory makes the evaluation plan executable without pretending that generated examples satisfy legal-quality review. The manifest contains only project-generated fixtures and their SHA-256 digests. Question records include issues, allowed source versions, gold passages, limitations, and explicit draft review state. Adversarial records define deterministic controls.

The validator rejects malformed hashes, missing source references, duplicate identifiers, adversarial cases without an executable test reference/review state, and any task or adversarial case labeled `approved` without two annotators and an adjudicator. The synthetic adversarial scaffold now contains the planned 24 deterministic cases; it is engineering evidence, not security or attorney approval.

Before private alpha, replace or extend this scaffold to the remaining targets in `evaluation-plan.md`: at least 32 source versions and 30 attorney-reviewed federal research tasks, plus security/legal adjudication of all 24 adversarial cases. Never add client, privileged, commercial-provider, PACER-restricted, or otherwise non-redistributable content.
