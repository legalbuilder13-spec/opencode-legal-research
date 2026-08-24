const state = { matters: [], selectedMatterId: null, citationDemo: null }
const $ = (selector) => document.querySelector(selector)

const bootstrap = await api("/api/bootstrap")
Object.assign(state, bootstrap)
$("#research-date").value = new Date().toISOString().slice(0, 10)
renderMatters()
renderCurrentMatter()
renderCitationDemo()
void loadAccount()
if (state.selectedMatterId) void Promise.all([loadSources(), loadAnswers()])

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item === button))
    document
      .querySelectorAll(".panel")
      .forEach((panel) => panel.classList.toggle("active", panel.id === `${button.dataset.panel}-panel`))
  })
})

$("#matter-picker").addEventListener("click", () => activate("matters"))
$("#matter-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const matter = await api("/api/matters", {
    method: "POST",
    body: JSON.stringify({
      name: $("#matter-name").value,
      jurisdiction: $("#jurisdiction").value,
      researchAsOf: $("#research-date").value,
      confidentiality: $("#confidentiality-input").value,
    }),
  })
  state.matters.unshift(matter)
  state.selectedMatterId = matter.id
  event.target.reset()
  $("#research-date").value = new Date().toISOString().slice(0, 10)
  renderMatters()
  renderCurrentMatter()
  await Promise.all([loadSources(), loadAnswers()])
  toast("Matter created and isolated")
  activate("research")
})

$("#matter-edit-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const matter = currentMatter()
  if (!matter) return
  const updated = await api(`/api/matters/${encodeURIComponent(matter.id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: $("#matter-edit-name").value,
      jurisdiction: $("#matter-edit-jurisdiction").value,
      researchAsOf: $("#matter-edit-date").value,
      clientLabel: $("#matter-edit-client").value,
      confidentiality: $("#matter-edit-confidentiality").value,
    }),
  })
  replaceMatter(updated)
  toast("Matter defaults saved")
})

$("#matter-status-button").addEventListener("click", async () => {
  const matter = currentMatter()
  if (!matter) return
  const updated = await api(`/api/matters/${encodeURIComponent(matter.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: matter.status === "active" ? "archived" : "active" }),
  })
  replaceMatter(updated)
  toast(updated.status === "active" ? "Matter reopened" : "Matter archived")
})

$("#source-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const matter = currentMatter()
  if (!matter) return toast("Create a matter before adding sources", true)
  await api(`/api/matters/${encodeURIComponent(matter.id)}/sources`, {
    method: "POST",
    body: JSON.stringify({ title: $("#source-title").value, text: $("#source-text").value }),
  })
  event.target.reset()
  await loadSources()
  toast("Source hashed and materialized")
})

$("#pdf-form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const matter = currentMatter()
  if (!matter) return toast("Create a matter before adding sources", true)
  const button = $("#pdf-button")
  button.disabled = true
  button.textContent = "Parsing and OCRing…"
  try {
    const result = await api(`/api/matters/${encodeURIComponent(matter.id)}/uploads`, {
      method: "POST",
      body: new FormData(event.target),
    })
    event.target.reset()
    $("#pdf-languages").value = "eng"
    await loadSources()
    const warningCount = Array.isArray(result.warnings) ? result.warnings.length : 0
    toast(
      `${result.pageCount} page PDF materialized in ${result.mode} mode${warningCount ? ` · ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}`,
    )
  } finally {
    button.disabled = false
    button.textContent = "Ingest and OCR PDF"
  }
})

$("#research-button").addEventListener("click", async () => {
  const matter = currentMatter()
  const question = $("#question").value.trim()
  if (!matter) return toast("Create or select a matter first", true)
  if (!question) return toast("Enter a focused legal question", true)
  $("#research-button").disabled = true
  $("#research-button").textContent = "Researching with ChatGPT…"
  try {
    const result = await api(`/api/matters/${encodeURIComponent(matter.id)}/answers`, {
      method: "POST",
      body: JSON.stringify({ question, proceduralPosture: $("#posture").value }),
    })
    renderPlan(result.plan)
    renderResults(result.research)
    renderGeneratedAnswer(result.answer)
  } finally {
    $("#research-button").disabled = false
    $("#research-button").textContent = "Research and draft"
  }
})

async function loadAccount() {
  try {
    const account = await api("/api/account")
    $("#account").innerHTML = ""
    const pulse = document.createElement("span")
    pulse.className = "pulse ready"
    const text = document.createElement("span")
    text.textContent =
      account.mode === "subscription" || account.mode === "chatgpt"
        ? `ChatGPT subscription · ${account.planType}`
        : "ChatGPT sign-in required"
    $("#account").append(pulse, text)
  } catch {
    $("#account").textContent = "Subscription status unavailable"
  }
}

function activate(name) {
  document.querySelector(`.nav-item[data-panel="${name}"]`).click()
}

function currentMatter() {
  return state.matters.find((matter) => matter.id === state.selectedMatterId) ?? null
}

function renderCurrentMatter() {
  const matter = currentMatter()
  $("#matter-picker").textContent = matter?.name ?? "Create your first matter"
  $("#confidentiality").textContent = matter ? matter.confidentiality : "No matter selected"
  $("#as-of").textContent = matter ? `As of ${matter.researchAsOf} · ${matter.jurisdiction}` : "Research date not set"
  $("#export-link").classList.toggle("disabled", !matter)
  $("#export-link").href = matter ? `/api/matters/${encodeURIComponent(matter.id)}/export` : "#"
  $("#matter-edit-form").hidden = !matter
  if (matter) {
    $("#matter-edit-name").value = matter.name
    $("#matter-edit-jurisdiction").value = matter.jurisdiction
    $("#matter-edit-date").value = matter.researchAsOf
    $("#matter-edit-client").value = matter.clientLabel ?? ""
    $("#matter-edit-confidentiality").value = matter.confidentiality
    $("#matter-status-button").textContent = matter.status === "active" ? "Archive matter" : "Reopen matter"
  }
}

function replaceMatter(updated) {
  const index = state.matters.findIndex((matter) => matter.id === updated.id)
  if (index >= 0) state.matters.splice(index, 1, updated)
  renderMatters()
  renderCurrentMatter()
}

function renderMatters() {
  $("#matter-count").textContent = `${state.matters.length} matter${state.matters.length === 1 ? "" : "s"}`
  $("#matter-list").replaceChildren(
    ...state.matters.map((matter) => {
      const button = document.createElement("button")
      button.className = `matter-row ${matter.id === state.selectedMatterId ? "selected" : ""}`
      const title = document.createElement("strong")
      title.textContent = matter.name
      const meta = document.createElement("span")
      meta.textContent = `${matter.jurisdiction} · ${matter.researchAsOf} · ${matter.status}`
      const label = document.createElement("small")
      label.textContent = matter.confidentiality
      button.append(title, meta, label)
      button.addEventListener("click", async () => {
        state.selectedMatterId = matter.id
        renderMatters()
        renderCurrentMatter()
        await Promise.all([loadSources(), loadAnswers()])
        activate("research")
      })
      return button
    }),
  )
}

async function loadSources() {
  const matter = currentMatter()
  if (!matter) return
  const sources = await api(`/api/matters/${encodeURIComponent(matter.id)}/sources`)
  $("#source-count").textContent = `${sources.length} source${sources.length === 1 ? "" : "s"}`
  $("#source-list").replaceChildren(
    ...sources.map((source) => {
      const article = document.createElement("article")
      article.className = "source-row"
      const kind = document.createElement("span")
      kind.className = "source-kind"
      kind.textContent = source.kind
      const title = document.createElement("strong")
      title.textContent = source.title
      const meta = document.createElement("span")
      const representation = source.representations.at(-1)
      const warnings = Array.isArray(representation?.warnings) ? representation.warnings.length : 0
      meta.textContent = `${source.mime} · ${source.capture_status}${representation ? ` · ${representation.parserName} ${representation.mode}` : ""}${warnings ? ` · ${warnings} warning${warnings === 1 ? "" : "s"}` : ""} · ${source.content_sha256.slice(0, 12)}…`
      article.append(kind, title, meta)
      return article
    }),
  )
}

async function loadAnswers() {
  const matter = currentMatter()
  if (!matter) return
  const answers = await api(`/api/matters/${encodeURIComponent(matter.id)}/answers`)
  renderGeneratedAnswer(answers[0] ?? null)
}

function renderPlan(plan) {
  const card = $("#plan-card")
  card.classList.remove("empty")
  card.replaceChildren()
  const eyebrow = document.createElement("p")
  eyebrow.className = "eyebrow"
  eyebrow.textContent = "Issue plan"
  const heading = document.createElement("h2")
  heading.textContent = `${plan.issues.length} issue${plan.issues.length === 1 ? "" : "s"}`
  const assumptions = document.createElement("p")
  assumptions.className = "plan-assumptions"
  assumptions.textContent = `${plan.assumptions.jurisdiction} · As of ${plan.assumptions.researchAsOf} · ${plan.assumptions.proceduralPosture}`
  const list = document.createElement("ol")
  plan.issues.forEach((issue) => {
    const item = document.createElement("li")
    item.textContent = issue.issue
    list.append(item)
  })
  const lanes = document.createElement("div")
  lanes.className = "lane-pills"
  plan.lanes.forEach((lane) => {
    const pill = document.createElement("span")
    pill.textContent = `${lane.kind} lane`
    lanes.append(pill)
  })
  card.append(eyebrow, heading, assumptions, list, lanes)
}

function renderResults(research) {
  const combined = [
    ...research.ordinary.results.map((result) => ({ ...result, lane: "primary" })),
    ...research.adverse.results.map((result) => ({ ...result, lane: "adverse" })),
  ]
  $("#result-count").textContent = `${combined.length} ranked passages`
  const root = $("#results")
  root.classList.remove("empty-results")
  root.replaceChildren(
    ...combined.map((result) => {
      const article = document.createElement("article")
      article.className = "result-card"
      const top = document.createElement("div")
      top.className = "result-top"
      const lane = document.createElement("span")
      lane.className = `lane ${result.lane}`
      lane.textContent = result.lane
      const eligibility = document.createElement("span")
      eligibility.className = result.supportEligible ? "eligible" : "lead-only"
      eligibility.textContent = result.supportEligible ? "support eligible" : "lead only"
      top.append(lane, eligibility)
      const title = document.createElement("strong")
      title.textContent = result.sourceTitle
      const quote = document.createElement("q")
      quote.textContent = result.text
      const id = document.createElement("code")
      id.textContent = result.passageId
      article.append(top, title, quote, id)
      return article
    }),
  )
}

function renderGeneratedAnswer(answer) {
  const root = $("#generated-answer")
  const text = $("#generated-answer-text")
  const status = $("#generated-answer-status")
  const exportLink = $("#answer-export-link")
  if (!answer) {
    root.classList.add("empty-answer")
    status.textContent = "No answer yet"
    exportLink.classList.add("disabled")
    exportLink.href = "#"
    text.textContent =
      "Research will retrieve matter evidence, ask the signed-in ChatGPT subscription for structured synthesis, then mint citations only after passage and hash checks pass."
    renderCitationDemo()
    return
  }
  root.classList.remove("empty-answer")
  status.textContent = answer.sourceComplete ? "Source-complete" : "Verification required"
  status.classList.toggle("warning", !answer.sourceComplete)
  exportLink.classList.remove("disabled")
  exportLink.href = `/api/answers/${encodeURIComponent(answer.id)}/export`
  text.replaceChildren()
  let cursor = 0
  for (const citation of [...answer.citations].sort((left, right) => left.claimEnd - right.claimEnd)) {
    text.append(document.createTextNode(answer.text.slice(cursor, citation.claimEnd)))
    const button = document.createElement("button")
    button.className = `citation ${citation.status}`
    button.textContent = citation.footnoteNumber
    button.setAttribute("aria-label", `Answer citation ${citation.footnoteNumber}: ${citation.status}`)
    button.addEventListener("mouseenter", () => showCitation(button, citation.citationId, "/api/answer-citations/"))
    button.addEventListener("focus", () => showCitation(button, citation.citationId, "/api/answer-citations/"))
    button.addEventListener("click", () => showCitation(button, citation.citationId, "/api/answer-citations/"))
    text.append(button)
    cursor = citation.claimEnd
  }
  text.append(document.createTextNode(answer.text.slice(cursor)))
  renderMatterEvidence(answer)
}

function renderMatterEvidence(answer) {
  $("#evidence-answer-label").textContent = "Current matter answer"
  $("#source-complete").textContent = answer.sourceComplete ? "Source-complete" : "Verification required"
  const root = $("#answer")
  root.replaceChildren()
  let cursor = 0
  for (const citation of [...answer.citations].sort((left, right) => left.claimEnd - right.claimEnd)) {
    root.append(document.createTextNode(answer.text.slice(cursor, citation.claimEnd)))
    const button = document.createElement("button")
    button.className = `citation ${citation.status}`
    button.textContent = citation.footnoteNumber
    button.setAttribute("aria-label", `Answer citation ${citation.footnoteNumber}: ${citation.status}`)
    button.addEventListener("mouseenter", () => showCitation(button, citation.citationId, "/api/answer-citations/"))
    button.addEventListener("focus", () => showCitation(button, citation.citationId, "/api/answer-citations/"))
    button.addEventListener("click", () => showCitation(button, citation.citationId, "/api/answer-citations/"))
    root.append(button)
    cursor = citation.claimEnd
  }
  root.append(document.createTextNode(answer.text.slice(cursor)))
  const ledger = new Map()
  for (const entry of answer.ledger) {
    ledger.set(entry.passage_id, [...(ledger.get(entry.passage_id) ?? []), entry.disposition])
  }
  renderLedger(ledger)
}

function renderCitationDemo() {
  const demo = state.citationDemo
  if (!demo) return
  $("#evidence-answer-label").textContent = "Synthetic protocol demonstration"
  $("#source-complete").textContent = demo.sourceComplete ? "Source-complete" : "Verification required"
  let cursor = 0
  const answer = $("#answer")
  answer.replaceChildren()
  for (const citation of [...demo.citations].sort((a, b) => a.claimEnd - b.claimEnd)) {
    answer.append(document.createTextNode(demo.text.slice(cursor, citation.claimEnd)))
    const button = document.createElement("button")
    button.className = `citation ${citation.status}`
    button.textContent = citation.footnoteNumber
    button.setAttribute("aria-label", `Citation ${citation.footnoteNumber}: ${citation.status}`)
    button.addEventListener("mouseenter", () => showCitation(button, citation.citationId))
    button.addEventListener("focus", () => showCitation(button, citation.citationId))
    button.addEventListener("click", () => showCitation(button, citation.citationId))
    answer.append(button)
    cursor = citation.claimEnd
  }
  answer.append(document.createTextNode(demo.text.slice(cursor)))
  const ledger = new Map()
  for (const entry of demo.ledger)
    ledger.set(entry.passage_id, [...(ledger.get(entry.passage_id) ?? []), entry.disposition])
  renderLedger(ledger)
}

function renderLedger(ledger) {
  $("#ledger").replaceChildren(
    ...[...ledger].map(([id, dispositions]) => {
      const item = document.createElement("li")
      item.textContent = `${id} · ${dispositions.includes("cited") ? "cited" : "read, not cited"}`
      return item
    }),
  )
}

async function showCitation(anchor, citationId, endpoint = "/api/citations/") {
  const citation = await api(`${endpoint}${encodeURIComponent(citationId)}`)
  const popover = $("#citation-popover")
  popover.replaceChildren()
  const heading = document.createElement("div")
  heading.className = "popover-heading"
  const title = document.createElement("strong")
  title.textContent = `Footnote ${citation.footnoteNumber} · ${citation.status}`
  const close = document.createElement("button")
  close.textContent = "×"
  close.setAttribute("aria-label", "Close citation")
  close.addEventListener("click", () => (popover.hidden = true))
  heading.append(title, close)
  popover.append(heading)
  citation.evidence.forEach((evidence) => {
    const card = document.createElement("button")
    card.className = "evidence-card"
    card.disabled = !evidence.available
    const badges = document.createElement("span")
    badges.className = "evidence-badges"
    badges.textContent = `${evidence.relationship} · ${evidence.verificationState}`
    const source = document.createElement("strong")
    source.textContent = evidence.sourceTitle
    const quote = document.createElement("q")
    quote.textContent = evidence.text ?? "Source unavailable"
    const location = document.createElement("small")
    location.textContent =
      evidence.locationMode === "coordinates" ? `Page ${evidence.pageNumber} · Exact region` : "Structural fallback"
    card.append(badges, source, quote, location)
    card.addEventListener("click", () => openEvidence(evidence))
    popover.append(card)
  })
  const rect = anchor.getBoundingClientRect()
  popover.style.left = `${Math.max(20, Math.min(window.innerWidth - 500, rect.left - 120))}px`
  popover.style.top = `${Math.max(20, Math.min(window.innerHeight - 460, rect.bottom + 8))}px`
  popover.hidden = false
}

function openEvidence(evidence) {
  if (!evidence.available) return
  activate("evidence")
  $("#viewer-empty").hidden = true
  $("#passage-detail").hidden = false
  $("#viewer-title").textContent = evidence.sourceTitle
  $("#passage-detail").textContent = evidence.text
  if (evidence.locationMode === "coordinates") {
    $("#page-viewer").hidden = false
    $("#page-label").textContent = `Page ${evidence.pageNumber}`
    $("#page-image").src = evidence.imageUrl
    Object.assign($("#page-highlight").style, {
      left: `${(evidence.bbox.left / evidence.pageWidth) * 100}%`,
      top: `${(evidence.bbox.top / evidence.pageHeight) * 100}%`,
      width: `${((evidence.bbox.right - evidence.bbox.left) / evidence.pageWidth) * 100}%`,
      height: `${Math.max(((evidence.bbox.bottom - evidence.bbox.top) / evidence.pageHeight) * 100, 1)}%`,
    })
  } else {
    $("#page-viewer").hidden = true
    $("#page-label").textContent = "Structural passage"
  }
  $("#citation-popover").hidden = true
}

async function api(path, init) {
  const headers = init?.body instanceof FormData ? undefined : { "Content-Type": "application/json" }
  const response = await fetch(path, { ...init, headers })
  const body = await response.json()
  if (!response.ok) {
    toast(body.error ?? "Request failed", true)
    throw new Error(body.error ?? "Request failed")
  }
  return body
}

function toast(message, error = false) {
  const element = $("#toast")
  element.textContent = message
  element.classList.toggle("error", error)
  element.hidden = false
  window.setTimeout(() => (element.hidden = true), 2800)
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") $("#citation-popover").hidden = true
})
