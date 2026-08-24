# Evaluation corpus v0

Status: synthetic scaffold; not attorney reviewed and not a release corpus

This directory makes the evaluation plan executable without pretending that generated examples satisfy legal-quality review. The manifest contains only project-generated fixtures and their SHA-256 digests. Question records include issues, allowed source versions, gold passages, limitations, and explicit draft review state. Adversarial records define deterministic controls.

The validator rejects malformed hashes, missing source references, duplicate identifiers, and any task labeled `approved` without two annotators and an adjudicator.

Before private alpha, replace or extend this scaffold to the targets in `evaluation-plan.md`: at least 32 source versions, 30 attorney-reviewed federal research tasks, and 24 adversarial cases. Never add client, privileged, commercial-provider, PACER-restricted, or otherwise non-redistributable content.
