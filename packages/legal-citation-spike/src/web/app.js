const answer = document.querySelector("#answer")
const popover = document.querySelector("#citation-popover")
const pageViewer = document.querySelector("#page-viewer")
const viewerEmpty = document.querySelector("#viewer-empty")
const pageImage = document.querySelector("#page-image")
const pageHighlight = document.querySelector("#page-highlight")
const pageLabel = document.querySelector("#page-label")
const sourceHeading = document.querySelector("#source-heading")
const passageDetail = document.querySelector("#passage-detail")
const completionStatus = document.querySelector("#completion-status")
const ledgerList = document.querySelector("#ledger-list")

const demo = await fetch("/api/demo").then((response) => response.json())
completionStatus.textContent = demo.sourceComplete ? "Source-complete" : "Verification required"
completionStatus.classList.add(demo.sourceComplete ? "complete" : "incomplete")
renderAnswer(demo)
renderLedger(demo.ledger)

function renderLedger(entries) {
  const passages = new Map()
  for (const entry of entries) {
    const dispositions = passages.get(entry.passage_id) ?? []
    dispositions.push(entry.disposition)
    passages.set(entry.passage_id, dispositions)
  }
  for (const [passageId, dispositions] of passages) {
    const item = document.createElement("li")
    item.textContent = `${passageId} · ${dispositions.includes("cited") ? "cited" : "read, not cited"}`
    ledgerList.append(item)
  }
}

function renderAnswer(message) {
  const citations = [...message.citations].sort((left, right) => left.claimEnd - right.claimEnd)
  let cursor = 0
  for (const citation of citations) {
    answer.append(document.createTextNode(message.text.slice(cursor, citation.claimEnd)))
    const button = document.createElement("button")
    button.className = `citation citation-${citation.status}`
    button.textContent = citation.footnoteNumber
    button.setAttribute("aria-label", `Citation ${citation.footnoteNumber}: ${citation.status}`)
    button.dataset.citationId = citation.citationId
    button.addEventListener("mouseenter", () => showCitation(button, citation.citationId))
    button.addEventListener("focus", () => showCitation(button, citation.citationId))
    button.addEventListener("click", () => showCitation(button, citation.citationId))
    answer.append(button)
    cursor = citation.claimEnd
  }
  answer.append(document.createTextNode(message.text.slice(cursor)))
}

async function showCitation(anchor, citationId) {
  const citation = await fetch(`/api/citations/${encodeURIComponent(citationId)}`).then((response) => response.json())
  popover.replaceChildren()
  const heading = document.createElement("div")
  heading.className = "popover-heading"
  heading.innerHTML = `<div><span class="status status-${citation.status}">${citation.status}</span><h3>Footnote ${citation.footnoteNumber}</h3></div><button class="close" aria-label="Close citation">×</button>`
  heading.querySelector(".close").addEventListener("click", () => (popover.hidden = true))
  popover.append(heading)
  const claim = document.createElement("p")
  claim.className = "claim-text"
  claim.textContent = citation.claimText
  popover.append(claim)

  for (const evidence of citation.evidence) {
    const card = document.createElement("button")
    card.className = "evidence-card"
    card.disabled = !evidence.available
    const relationship = document.createElement("span")
    relationship.className = `relationship relationship-${evidence.relationship}`
    relationship.textContent = evidence.relationship
    const source = document.createElement("strong")
    source.textContent = evidence.sourceTitle
    const quote = document.createElement("q")
    quote.textContent = evidence.text ?? "Source version was deleted; passage content is unavailable."
    const location = document.createElement("span")
    location.className = "location"
    location.textContent = !evidence.available
      ? "Unavailable"
      : evidence.locationMode === "coordinates"
        ? `Page ${evidence.pageNumber} · Open exact region`
        : "Structural text fallback · No page coordinates"
    const verification = document.createElement("span")
    verification.className = `verification verification-${evidence.verificationState}`
    verification.textContent = evidence.verificationState
    card.append(relationship, verification, source, quote, location)
    card.addEventListener("click", () => openEvidence(evidence))
    popover.append(card)
  }

  const rect = anchor.getBoundingClientRect()
  popover.style.left = `${Math.min(window.innerWidth - 500, Math.max(18, rect.left - 120))}px`
  popover.style.top = `${Math.min(window.innerHeight - 420, rect.bottom + 10)}px`
  popover.hidden = false
}

function openEvidence(evidence) {
  if (!evidence.available) return
  if (evidence.locationMode === "structural-fallback") {
    viewerEmpty.hidden = false
    pageViewer.hidden = true
    viewerEmpty.textContent =
      "This source has no stored page coordinates. The persisted structural passage remains available in the evidence card."
    popover.hidden = true
    return
  }
  viewerEmpty.hidden = true
  pageViewer.hidden = false
  passageDetail.hidden = false
  pageImage.src = evidence.imageUrl
  pageLabel.textContent = `Page ${evidence.pageNumber}`
  sourceHeading.textContent = evidence.sourceTitle
  passageDetail.innerHTML = ""
  const relationship = document.createElement("span")
  relationship.className = `relationship relationship-${evidence.relationship}`
  relationship.textContent = evidence.relationship
  const text = document.createElement("q")
  text.textContent = evidence.text
  passageDetail.append(relationship, text)
  const left = (evidence.bbox.left / evidence.pageWidth) * 100
  const top = (evidence.bbox.top / evidence.pageHeight) * 100
  const width = ((evidence.bbox.right - evidence.bbox.left) / evidence.pageWidth) * 100
  const height = ((evidence.bbox.bottom - evidence.bbox.top) / evidence.pageHeight) * 100
  Object.assign(pageHighlight.style, {
    left: `${left}%`,
    top: `${top}%`,
    width: `${width}%`,
    height: `${Math.max(height, 1.1)}%`,
  })
  popover.hidden = true
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") popover.hidden = true
})
