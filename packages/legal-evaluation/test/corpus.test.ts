import { describe, expect, test } from "bun:test"
import { resolve } from "node:path"
import { loadCorpus, validateCorpus } from "../src"

const corpusRoot = resolve(import.meta.dir, "../../../specs/legal-research/corpus/v0")

describe("versioned legal evaluation corpus", () => {
  test("EVAL-01 validates source hashes, references, review state, and adversarial IDs", async () => {
    const corpus = await loadCorpus(corpusRoot)
    expect(validateCorpus(corpus)).toEqual([])
    expect(corpus.adversarial).toHaveLength(24)
  })

  test("EVAL-04 requires executable references and review state for adversarial cases", async () => {
    const corpus = await loadCorpus(corpusRoot)
    const adversarial = structuredClone(corpus.adversarial)
    if (!Array.isArray(adversarial) || !adversarial[0] || typeof adversarial[0] !== "object")
      throw new Error("Invalid fixture")
    delete adversarial[0].test_ref
    delete adversarial[0].review
    const errors = validateCorpus({ ...corpus, adversarial })
    expect(errors).toContain("adversarial[0].test_ref must be a non-empty string")
    expect(errors).toContain("adversarial[0].review must be an object")
  })

  test("EVAL-02 blocks an approved task without two reviewers and adjudication", async () => {
    const corpus = await loadCorpus(corpusRoot)
    const questions = structuredClone(corpus.questions)
    if (!Array.isArray(questions) || !questions[0] || typeof questions[0] !== "object")
      throw new Error("Invalid fixture")
    questions[0].review = { status: "approved", annotators: [] }
    const errors = validateCorpus({ ...corpus, questions })
    expect(errors).toContain("questions[0].review requires two annotators when approved")
    expect(errors).toContain("questions[0].review.adjudicated_by must be a non-empty string")
  })

  test("EVAL-03 blocks unknown source references and malformed content hashes", async () => {
    const corpus = await loadCorpus(corpusRoot)
    const questions = structuredClone(corpus.questions)
    if (!Array.isArray(questions) || !questions[0] || typeof questions[0] !== "object")
      throw new Error("Invalid fixture")
    questions[0].allowed_source_versions = ["srcv_missing"]
    const manifestValue = structuredClone(corpus.manifest)
    if (!manifestValue || typeof manifestValue !== "object" || Array.isArray(manifestValue))
      throw new Error("Invalid fixture")
    const manifest = Object.fromEntries(Object.entries(manifestValue))
    if (!Array.isArray(manifest.sources) || !manifest.sources[0] || typeof manifest.sources[0] !== "object")
      throw new Error("Invalid fixture")
    Object.assign(manifest.sources[0], { sha256: "not-a-hash" })
    const errors = validateCorpus({ ...corpus, manifest, questions })
    expect(errors).toContain("manifest.sources[0].sha256 must be lowercase SHA-256")
    expect(errors).toContain("questions[0] references unknown source: srcv_missing")
  })
})
