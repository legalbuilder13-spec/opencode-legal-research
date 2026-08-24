import { readFile } from "node:fs/promises"
import { join } from "node:path"

export interface CorpusBundle {
  manifest: unknown
  questions: unknown
  adversarial: unknown
}

export async function loadCorpus(root: string): Promise<CorpusBundle> {
  const files = await Promise.all(
    ["manifest.json", "questions.json", "adversarial.json"].map(async (name) =>
      JSON.parse(await readFile(join(root, name), "utf8")),
    ),
  )
  return { manifest: files[0], questions: files[1], adversarial: files[2] }
}

export function validateCorpus(bundle: CorpusBundle): string[] {
  const errors: string[] = []
  const manifest = record(bundle.manifest, "manifest", errors)
  const questions = array(bundle.questions, "questions", errors)
  const adversarial = array(bundle.adversarial, "adversarial", errors)
  const sources = array(manifest?.sources, "manifest.sources", errors)
  const sourceIds = new Set<string>()

  for (const [index, sourceValue] of sources.entries()) {
    const source = record(sourceValue, `manifest.sources[${index}]`, errors)
    const id = requiredString(source?.source_version_id, `manifest.sources[${index}].source_version_id`, errors)
    if (id) {
      if (sourceIds.has(id)) errors.push(`duplicate source_version_id: ${id}`)
      sourceIds.add(id)
    }
    const hash = requiredString(source?.sha256, `manifest.sources[${index}].sha256`, errors)
    if (hash && !/^[a-f0-9]{64}$/.test(hash)) errors.push(`manifest.sources[${index}].sha256 must be lowercase SHA-256`)
    requiredString(source?.license_basis, `manifest.sources[${index}].license_basis`, errors)
    requiredString(source?.path, `manifest.sources[${index}].path`, errors)
  }

  const taskIds = new Set<string>()
  for (const [index, taskValue] of questions.entries()) {
    const path = `questions[${index}]`
    const task = record(taskValue, path, errors)
    const id = requiredString(task?.task_id, `${path}.task_id`, errors)
    if (id) {
      if (taskIds.has(id)) errors.push(`duplicate task_id: ${id}`)
      taskIds.add(id)
    }
    requiredString(task?.question, `${path}.question`, errors)
    requiredString(task?.as_of, `${path}.as_of`, errors)
    const allowed = array(task?.allowed_source_versions, `${path}.allowed_source_versions`, errors)
    for (const sourceId of allowed) {
      if (typeof sourceId !== "string" || !sourceIds.has(sourceId))
        errors.push(`${path} references unknown source: ${String(sourceId)}`)
    }
    const goldPassages = array(task?.gold_passages, `${path}.gold_passages`, errors)
    for (const [passageIndex, passageValue] of goldPassages.entries()) {
      const passagePath = `${path}.gold_passages[${passageIndex}]`
      const passage = record(passageValue, passagePath, errors)
      requiredString(passage?.passage_id, `${passagePath}.passage_id`, errors)
      const sourceId = requiredString(passage?.source_version_id, `${passagePath}.source_version_id`, errors)
      if (sourceId && !sourceIds.has(sourceId)) errors.push(`${passagePath} references unknown source: ${sourceId}`)
      const textHash = requiredString(passage?.text_sha256, `${passagePath}.text_sha256`, errors)
      if (textHash && !/^[a-f0-9]{64}$/.test(textHash))
        errors.push(`${passagePath}.text_sha256 must be lowercase SHA-256`)
    }
    validateReview(task?.review, `${path}.review`, errors)
  }

  const caseIds = new Set<string>()
  for (const [index, caseValue] of adversarial.entries()) {
    const path = `adversarial[${index}]`
    const testCase = record(caseValue, path, errors)
    const id = requiredString(testCase?.case_id, `${path}.case_id`, errors)
    if (id) {
      if (caseIds.has(id)) errors.push(`duplicate case_id: ${id}`)
      caseIds.add(id)
    }
    requiredString(testCase?.category, `${path}.category`, errors)
    requiredString(testCase?.payload, `${path}.payload`, errors)
    requiredString(testCase?.expected_control, `${path}.expected_control`, errors)
    requiredString(testCase?.test_ref, `${path}.test_ref`, errors)
    validateReview(testCase?.review, `${path}.review`, errors)
  }

  requiredString(manifest?.corpus_version, "manifest.corpus_version", errors)
  requiredString(manifest?.status, "manifest.status", errors)
  return errors
}

function validateReview(value: unknown, path: string, errors: string[]) {
  const review = record(value, path, errors)
  const status = requiredString(review?.status, `${path}.status`, errors)
  const annotators = array(review?.annotators, `${path}.annotators`, errors)
  if (status === "approved") {
    if (annotators.filter((name) => typeof name === "string" && name.length > 0).length < 2)
      errors.push(`${path} requires two annotators when approved`)
    requiredString(review?.adjudicated_by, `${path}.adjudicated_by`, errors)
  }
}

function record(value: unknown, path: string, errors: string[]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${path} must be an object`)
    return undefined
  }
  return Object.fromEntries(Object.entries(value))
}

function array(value: unknown, path: string, errors: string[]): unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`)
    return []
  }
  return value
}

function requiredString(value: unknown, path: string, errors: string[]): string | undefined {
  if (typeof value !== "string" || !value.trim()) {
    errors.push(`${path} must be a non-empty string`)
    return undefined
  }
  return value
}
