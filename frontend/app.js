(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.QuorumXFrontend = api;
  if (typeof document !== "undefined") document.addEventListener("DOMContentLoaded", api.init);
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const API = "https://api.quorumx.dev";
  const state = { sources: [], proposals: [], nextCursor: null, filters: {}, search: "" };

  const $ = (selector, scope = document) => scope.querySelector(selector);
  const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char]));
  const titleCase = (value) => String(value ?? "").replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
  const short = (value, start = 6, end = 4) => value && value.length > start + end ? `${value.slice(0, start)}…${value.slice(-end)}` : value ?? "—";
  const safeHttpUrl = (value) => { try { const url = new URL(value); return url.protocol === "https:" ? url.href : "#"; } catch { return "#"; } };
  const formatDate = (value, options = { month: "short", day: "numeric", year: "numeric" }) => value ? new Intl.DateTimeFormat("en", options).format(new Date(value)) : "—";
  const daysUntil = (value, now = Date.now()) => value ? Math.ceil((new Date(value).getTime() - now) / 86400000) : null;
  const lifecycle = {
    indexed: ["Indexed", "The canonical proposal is indexed but has no eligible assessment job."],
    waiting_capacity: ["Waiting for capacity", "The eligible revision is durably queued and waiting for submission capacity."],
    processing: ["Processing", "The Worker has claimed the job and is preparing or submitting it."],
    submitted: ["Submitted", "A GenLayer transaction exists and finalization is pending."],
    retrying: ["Retrying", "A bounded retry is scheduled after a recoverable failure."],
    finalized: ["Accepted", "An accepted assessment passed schema and hash validation."],
    unavailable: ["Unavailable", "Bounded retries ended or a non-recoverable failure occurred."],
  };
  const assessmentLabel = (status) => lifecycle[status]?.[0] ?? (status ? titleCase(status) : "Not assessed");
  const assessmentExplanation = (status) => lifecycle[status]?.[1] ?? "No accepted assessment is available.";
  const priorityRank = { urgent: 4, high: 3, normal: 2, low: 1 };
  const assessmentSignal = (proposal) => ["2", "3"].includes(proposal.assessmentVersion)
    ? `${titleCase(proposal.reviewPriority)} review · ${proposal.findingCount ?? proposal.dueDiligence?.findings?.length ?? 0} findings`
    : proposal.riskLevel ? "Legacy risk assessment" : "Not yet reviewed";

  function buildProposalQuery(filters = {}, cursor, limit = 24) {
    const params = new URLSearchParams({ limit: String(limit) });
    ["status", "assessment", "ecosystem", "author", "source", "dao", "space"].forEach((key) => {
      if (filters[key]) params.set(key, filters[key]);
    });
    if (cursor) params.set("cursor", cursor);
    return `${API}/v1/proposals?${params}`;
  }

  async function requestJson(url) {
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`The public index returned ${response.status}`);
    return response.json();
  }

  function proposalMatchesSearch(proposal, search) {
    if (!search) return true;
    const haystack = [proposal.title, proposal.daoName, proposal.space, proposal.authorAddress, proposal.canonicalId, proposal.transactionHash].join(" ").toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }

  function proposalRow(proposal) {
    const risk = assessmentSignal(proposal);
    return `<tr>
      <td><button class="proposal-title-button" type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}">${escapeHtml(proposal.title)}</button></td>
      <td><span class="dao-cell"><img src="${escapeHtml(safeHttpUrl(proposal.daoLogoUrl))}" alt="" loading="lazy">${escapeHtml(proposal.daoName)}</span></td>
      <td><span class="badge ${proposal.status === "active" ? "badge-active" : ""}">${escapeHtml(titleCase(proposal.status))}</span></td>
      <td><span class="${["2", "3"].includes(proposal.assessmentVersion) ? "badge-finalized" : "risk-none"}">${escapeHtml(risk)}</span></td>
      <td><span class="badge ${proposal.assessmentStatus === "finalized" ? "badge-finalized" : ""}">${escapeHtml(assessmentLabel(proposal.assessmentStatus))}</span></td>
      <td>${escapeHtml(formatDate(proposal.votingEndsAt, { month: "short", day: "numeric", year: "numeric" }))}</td>
      <td><button class="proposal-title-button row-arrow" type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}" aria-label="Open ${escapeHtml(proposal.title)}">→</button></td>
    </tr>`;
  }

  function mobileProposal(proposal) {
    const risk = assessmentSignal(proposal);
    return `<article class="mobile-card"><button type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}"><span class="dao-cell"><img src="${escapeHtml(safeHttpUrl(proposal.daoLogoUrl))}" alt="">${escapeHtml(proposal.daoName)}</span><h3>${escapeHtml(proposal.title)}</h3><span class="mobile-card-meta"><span class="badge ${proposal.status === "active" ? "badge-active" : ""}">${escapeHtml(titleCase(proposal.status))}</span><span class="badge">${escapeHtml(risk)}</span><span class="badge">Ends ${escapeHtml(formatDate(proposal.votingEndsAt, { month: "short", day: "numeric" }))}</span></span></button></article>`;
  }

  function renderProposals() {
    const visible = state.proposals.filter((proposal) => proposalMatchesSearch(proposal, state.search));
    $("[data-proposals]").innerHTML = visible.length ? visible.map(proposalRow).join("") : '<tr><td colspan="7"><div class="empty-block">No proposals match these filters.</div></td></tr>';
    $("[data-mobile-proposals]").innerHTML = visible.length ? visible.map(mobileProposal).join("") : '<div class="empty-block">No proposals match these filters.</div>';
    $("[data-index-status]").textContent = `${visible.length} proposal${visible.length === 1 ? "" : "s"} shown · Live data from api.quorumx.dev`;
    $("[data-load-more]").hidden = !state.nextCursor;
  }

  async function loadProposals(append = false, limit = 24) {
    const target = $("[data-index-status]");
    target.textContent = append ? "Loading more proposals…" : "Refreshing the public index…";
    try {
      const payload = await requestJson(buildProposalQuery(state.filters, append ? state.nextCursor : undefined, limit));
      state.proposals = append ? [...state.proposals, ...payload.data] : payload.data;
      state.nextCursor = payload.page?.nextCursor ?? null;
      renderProposals();
    } catch (error) {
      target.textContent = `Proposal index unavailable: ${error.message}`;
      if (!append) {
        $("[data-proposals]").innerHTML = '<tr><td colspan="7"><div class="error-block">The proposal index could not be loaded. Public documentation remains available below.</div></td></tr>';
        $("[data-mobile-proposals]").innerHTML = '<div class="error-block">The proposal index could not be loaded.</div>';
      }
    }
  }

  function attentionCard(proposal, primary) {
    const days = daysUntil(proposal.votingEndsAt);
    const deadline = days === null ? "No deadline" : days <= 0 ? "Voting window ended" : `${days} day${days === 1 ? "" : "s"} remaining`;
    const risk = assessmentSignal(proposal);
    const reason = ["2", "3"].includes(proposal.assessmentVersion)
      ? `${proposal.findingCount ?? 0} evidence-backed findings and ${proposal.unresolvedCount ?? 0} unresolved questions are available for inspection.`
      : proposal.riskLevel
        ? "A legacy assessment exists. Its historical score does not represent a probability or a defined weighted total."
        : "This proposal remains within its public voting window and awaits due-diligence review.";
    return `<article class="attention-card ${primary ? "is-primary" : ""}"><p class="dao-line">${escapeHtml(proposal.daoName)} · ${escapeHtml(proposal.space)}</p><h3>${escapeHtml(proposal.title)}</h3><p class="attention-reason">${escapeHtml(reason)}</p><div class="attention-meta"><span class="badge badge-active">${escapeHtml(titleCase(proposal.status))}</span><span class="badge">${escapeHtml(risk)}</span><span class="badge">${escapeHtml(deadline)}</span></div><button type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}">Inspect this proposal →</button></article>`;
  }

  async function loadAttention() {
    const target = $("[data-attention]");
    try {
      const payload = await requestJson(buildProposalQuery({ status: "active" }));
      const ranked = payload.data.sort((a, b) => (priorityRank[b.reviewPriority] ?? 0) - (priorityRank[a.reviewPriority] ?? 0)
        || (daysUntil(a.votingEndsAt) ?? 999) - (daysUntil(b.votingEndsAt) ?? 999)).slice(0, 2);
      target.innerHTML = ranked.length ? ranked.map((proposal, index) => attentionCard(proposal, index === 0)).join("") : '<div class="empty-block">No active proposal currently requires priority review.</div>';
    } catch (error) { target.innerHTML = `<div class="error-block">Priority queue unavailable: ${escapeHtml(error.message)}</div>`; }
  }

  function assessmentRow(proposal) {
    return `<article class="assessment-row"><button type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}">${escapeHtml(proposal.title)}<small>${escapeHtml(proposal.daoName)}</small></button><span>${escapeHtml(assessmentSignal(proposal))}</span><span>${escapeHtml(["2", "3"].includes(proposal.assessmentVersion) ? `Consensus findings · v${proposal.assessmentVersion}` : "Legacy model")}</span><span>${escapeHtml(formatDate(proposal.assessedAt))}</span><button class="proposal-title-button row-arrow" type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}" aria-label="Open assessment">→</button></article>`;
  }

  async function loadAssessments() {
    const target = $("[data-assessments]");
    try {
      const payload = await requestJson(buildProposalQuery({ assessment: "finalized" }));
      target.innerHTML = payload.data.length ? payload.data.slice(0, 8).map(assessmentRow).join("") : '<div class="empty-block">No accepted assessments are currently indexed.</div>';
    } catch (error) { target.innerHTML = `<div class="error-block">Assessments unavailable: ${escapeHtml(error.message)}</div>`; }
  }

  function sourceCard(source) {
    const space = source.configuration?.space ?? "—";
    return `<article class="dao-card"><img src="${escapeHtml(safeHttpUrl(source.logoUrl))}" alt="${escapeHtml(source.displayName)} logo" loading="lazy"><h3>${escapeHtml(source.displayName)}</h3><p>${escapeHtml(source.ecosystems.join(" · "))}</p><dl><dt>Snapshot space</dt><dd>${escapeHtml(space)}</dd><dt>Open-proposal coverage</dt><dd>${escapeHtml(source.coverageState === "covered" ? "Complete fixed-point pass" : `Scanning · generation ${source.scanGeneration ?? 1}, offset ${source.scanOffset ?? 0}`)}</dd><dt>Assessment backlog</dt><dd>${escapeHtml(`${source.backlogCount ?? 0} queued${source.oldestBacklogAt ? ` · oldest ${formatDate(source.oldestBacklogAt, { month: "short", day: "numeric" })}` : ""}`)}</dd><dt>Submission capacity</dt><dd>${escapeHtml(source.dailyAssessmentBudget)}/day</dd><dt>Last indexed</dt><dd>${escapeHtml(formatDate(source.lastSucceededAt, { month: "short", day: "numeric" }))}</dd></dl><a href="${escapeHtml(safeHttpUrl(source.homepageUrl))}">Visit governance source ↗</a></article>`;
  }

  async function loadSources() {
    const target = $("[data-daos]");
    try {
      const payload = await requestJson(`${API}/v1/sources`);
      state.sources = payload.data;
      target.innerHTML = state.sources.map(sourceCard).join("");
      const select = $("[data-filter-dao]");
      select.insertAdjacentHTML("beforeend", state.sources.map((source) => `<option value="${escapeHtml(source.configuration.space)}">${escapeHtml(source.displayName)}</option>`).join(""));
    } catch (error) { target.innerHTML = `<div class="error-block">DAO directory unavailable: ${escapeHtml(error.message)}</div>`; }
  }

  function fact(label, value) { return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value ?? "—")}</dd></div>`; }
  function evidenceItem(label, value, href) { return `<div class="evidence-item"><span>${escapeHtml(label)}</span>${href ? `<a href="${escapeHtml(safeHttpUrl(href))}" target="_blank" rel="noreferrer">${escapeHtml(value)} ↗</a>` : `<strong>${escapeHtml(value ?? "—")}</strong>`}</div>`; }

  function renderDueDiligence(assessment, changes = []) {
    const overview = assessment.overview;
    const claims = assessment.materialClaims ?? [], findings = assessment.findings ?? [];
    const questions = assessment.unresolvedQuestions ?? [], steps = assessment.executionMap ?? [];
    const evidence = assessment.evidence ?? [];
    const evidenceById = Object.fromEntries(evidence.map((item) => [item.id, item]));
    const safeguardById = Object.fromEntries((assessment.safeguardGaps ?? []).map((item) => [item.id, item]));
    const isV3 = assessment.assessmentVersion === "3";
    const factualClaims = isV3 ? claims.filter((claim) => claim.claimScope === "external_factual") : claims;
    const proposalAssertions = isV3 ? claims.filter((claim) => claim.claimScope === "proposal_action").length : 0;
    const claimCounts = factualClaims.reduce((counts, claim) => { counts[claim.status] = (counts[claim.status] ?? 0) + 1; return counts; }, {});
    const rpcFailure = assessment.externalEvidenceFailureCode ?? "";
    const rpcFailureLabel = /^rpc_(publicnode|drpc)_http_([1-5]\d\d)$/.exec(rpcFailure);
    const evidenceFailureText = rpcFailureLabel ? ` — ${rpcFailureLabel[1]} returned HTTP ${rpcFailureLabel[2]}`
      : /^rpc_(publicnode|drpc)_request_error$/.test(rpcFailure) ? " — an RPC provider request could not complete"
        : rpcFailure === "rpc_block_disagreement" ? " — providers disagreed on the pinned block"
          : rpcFailure === "rpc_safe_call_disagreement" ? " — providers disagreed on the Safe configuration"
            : rpcFailure ? " — the RPC response did not pass validation" : "";
    const list = (items) => items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : '<p class="due-empty">None identified in the reviewed proposal material.</p>';
    const refs = (ids) => (ids ?? []).map((id) => {
      const item = evidenceById[id];
      return item ? `<a href="#evidence-${escapeHtml(item.id)}">${escapeHtml(item.description)}</a>` : "";
    }).filter(Boolean).join(" · ");
    const evidenceLabel = (item) => `${item.verificationScope === "validator_retrieved_external_source" ? "Validator-retrieved external source" : "Validator-retrieved proposal"} · ${titleCase(item.authority ?? "primary")} authority`;
    const relatedLinks = (question) => [
      ...(question.relatedFindingIds ?? []).map((id) => [id, `finding-${id}`]),
      ...(question.relatedClaimIds ?? []).map((id) => [id, `claim-${id}`]),
      ...(question.relatedExecutionStepIds ?? []).map((id) => [id, `execution-${id}`]),
    ].map(([label, target]) => `<a href="#${escapeHtml(target)}">${escapeHtml(label)}</a>`).join(" · ");
    const dueSchema = assessment.assessmentSchemaVersion ? ` · schema ${escapeHtml(assessment.assessmentSchemaVersion)}` : "";
    return `<div class="due-diligence"><p class="overline">Consensus-backed due diligence · v${escapeHtml(assessment.assessmentVersion ?? "2")}${dueSchema}</p>
      <h3>What this proposal does</h3><p>${escapeHtml(overview.purpose)}</p>
      <h4>Requested actions</h4>${list(overview.requestedActions ?? [])}
      <div class="due-facts">${fact("Assets affected", (overview.assetsAffected ?? []).join("; ") || "None identified")}${fact("Permissions changed", (overview.permissionsChanged ?? []).join("; ") || "None identified")}${fact("Control changes", (overview.controlChanges ?? []).join("; ") || "None identified")}</div>
      ${claims.map((claim) => `<span id="claim-${escapeHtml(claim.id)}"></span>`).join("")}<h3>Material claims <small>${claims.length}</small></h3>
      <p class="due-counts">${isV3 ? `Proposal assertions: ${proposalAssertions} · ` : ""}${["supported", "partially_supported", "unverified", "contradicted"].map((status) => `${escapeHtml(titleCase(status))}: ${claimCounts[status] ?? 0}`).join(" · ")}</p>
      ${isV3 ? `<p class="due-meta">${assessment.assessmentSchemaVersion === "3.2" ? "Dual-RPC Safe state check" : "Safe evidence"}: ${escapeHtml(titleCase(assessment.externalEvidenceState))}${assessment.externalEvidenceState === "unavailable" ? ` — Safe claims remain unverified${escapeHtml(evidenceFailureText)}.` : ""}${assessment.returnedFundsState ? ` · Returned-funds trace: ${escapeHtml(titleCase(assessment.returnedFundsState))}` : ""}</p>` : ""}
      ${claims.length ? claims.map((claim) => `<details class="due-item"><summary><span>${escapeHtml(claim.claim)}</span><strong>${escapeHtml(claim.claimScope === "proposal_action" ? "Proposal assertion" : titleCase(claim.status))}</strong></summary><p><strong>${claim.claimScope === "proposal_action" ? "Proposal assertion — source presence only" : "Proposal claim"}</strong></p><blockquote>${escapeHtml(claim.sourceExcerpt)}</blockquote><p><strong>QuorumX finding</strong>: ${escapeHtml(claim.explanation)}</p>${claim.counterExcerpt ? `<blockquote>${escapeHtml(claim.counterExcerpt)}</blockquote>` : ""}<p>Confidence: ${escapeHtml(titleCase(claim.confidence))} · ${claim.claimScope === "proposal_action" ? "Does not establish execution" : "External factual claim"}${claim.verificationMethod ? ` · Method: ${escapeHtml(titleCase(claim.verificationMethod))}` : ""}</p><p>Evidence: ${refs(claim.evidence)}</p></details>`).join("") : '<p class="due-empty">No measurable material claims identified.</p>'}
      ${findings.map((finding) => `<span id="finding-${escapeHtml(finding.id)}"></span>`).join("")}${steps.map((step) => `<span id="execution-${escapeHtml(step.id)}"></span>`).join("")}<h3>Material findings <small>${findings.length}</small></h3>
      ${findings.length ? findings.map((finding) => { const gaps = finding.safeguardGaps ?? (finding.safeguardGapIds ?? []).map((id) => safeguardById[id]).filter(Boolean); return `<article class="due-item"><h4>${escapeHtml(finding.title)}</h4><p class="due-meta">${escapeHtml(titleCase(finding.severity))} severity · ${escapeHtml(titleCase(finding.confidence))} confidence · ${finding.consensus?.state === "accepted" ? "Consensus accepted" : "Consensus unavailable"}</p><dl><dt>Observed</dt><dd>${escapeHtml(finding.observation)}</dd>${finding.sourceExcerpt ? `<dt>Source passage</dt><dd><blockquote>${escapeHtml(finding.sourceExcerpt)}</blockquote></dd>` : ""}<dt>Why it matters</dt><dd>${escapeHtml(finding.whyItMatters)}</dd><dt>Impact</dt><dd>${escapeHtml(finding.impact || "Not established from reviewed evidence.")}</dd><dt>Existing safeguards</dt><dd>${escapeHtml((finding.existingSafeguards ?? []).join("; ") || "None identified")}</dd>${gaps.length ? `<dt>Safeguard review state</dt><dd>${gaps.map((gap) => `${escapeHtml(gap.safeguard)}: ${escapeHtml(gap.state === "not_identified" ? "Not Identified in reviewed material" : titleCase(gap.state))} — ${escapeHtml(gap.scope)}`).join("; ")}</dd>` : finding.missingSafeguards?.length ? `<dt>Missing safeguards</dt><dd>${escapeHtml(finding.missingSafeguards.join("; "))}</dd>` : ""}${finding.humanDependencies?.length ? `<dt>Human dependencies</dt><dd>${escapeHtml(finding.humanDependencies.join("; "))}</dd>` : ""}${finding.technicalDependencies?.length ? `<dt>Technical dependencies</dt><dd>${escapeHtml(finding.technicalDependencies.join("; "))}</dd>` : ""}<dt>Reversibility</dt><dd>${escapeHtml(String(finding.reversible))}</dd>${finding.uncertainty ? `<dt>Uncertainty</dt><dd>${escapeHtml(finding.uncertainty)}</dd>` : ""}<dt>Evidence</dt><dd>${refs(finding.evidence)}</dd></dl></article>`; }).join("") : '<p class="due-empty">No material finding identified in the reviewed proposal material.</p>'}
      <h3>Execution map</h3>${steps.length ? `<ol class="due-steps">${steps.map((step) => `<li><strong>${escapeHtml(step.action)}</strong>${step.amount || step.asset ? `<span>${escapeHtml([step.amount, step.asset].filter(Boolean).join(" "))}</span>` : ""}<dl>${step.actor ? `<dt>Actor</dt><dd>${escapeHtml(step.actor)}</dd>` : ""}${step.target ? `<dt>Target</dt><dd>${escapeHtml(step.target)}</dd>` : ""}${step.humanDependencies?.length ? `<dt>Human dependencies</dt><dd>${escapeHtml(step.humanDependencies.join("; "))}</dd>` : ""}${step.technicalDependencies?.length ? `<dt>Technical dependencies</dt><dd>${escapeHtml(step.technicalDependencies.join("; "))}</dd>` : ""}${step.dependency ? `<dt>Dependency</dt><dd>${escapeHtml(step.dependency)}</dd>` : ""}<dt>Impact</dt><dd>${escapeHtml(step.impact || "Not established from reviewed evidence.")}</dd></dl><small>Reversible: ${escapeHtml(String(step.reversible))} · ${refs(step.evidence)}</small></li>`).join("")}</ol><p class="due-meta">${steps.some((step) => /not establish|not identified|unknown/i.test(`${step.impact} ${step.dependency}`)) ? "Subsequent execution path not established from reviewed evidence." : "Only the execution sequence established by reviewed evidence is shown."}</p>` : '<p class="due-empty">No execution step identified.</p>'}
      <h3>Unresolved questions <small>${questions.length}</small></h3>${questions.length ? questions.map((question) => `<article class="due-item"><h4>${escapeHtml(question.question)}</h4><p>${escapeHtml(question.whyItMatters)}</p>${question.evidenceGap ? `<p>Evidence gap: ${escapeHtml(question.evidenceGap)}</p>` : ""}${relatedLinks(question) ? `<p>Related: ${relatedLinks(question)}</p>` : ""}</article>`).join("") : '<p class="due-empty">No material question identified in the reviewed proposal material.</p>'}
      <h3>Changes since previous revision <small>${changes.filter((change) => change.significance === "material").length} material</small></h3>
      ${changes.length ? changes.map((change) => `<article class="due-item"><h4>${escapeHtml(change.field)}</h4><p>${escapeHtml(change.previousValue ?? "—")} → ${escapeHtml(change.currentValue ?? "—")}</p><small>${escapeHtml(change.explanation)}</small></article>`).join("") : '<p class="due-empty">No earlier indexed revision is available for comparison.</p>'}
      <h3>Evidence</h3>${evidence.map((item) => { const href = safeHttpUrl(item.locator); return `<div class="due-evidence" id="evidence-${escapeHtml(item.id)}">${href === "#" ? `<strong>${escapeHtml(item.description)}</strong>` : `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(item.description)} ↗</a>`}<small>${escapeHtml(evidenceLabel(item))} · ${escapeHtml(item.type === "safe" || item.type === "safe_onchain" || item.type === "onchain" ? "Provider-reported secondary evidence; not a cryptographic state/inclusion proof" : "SHA-256 " + short(item.contentHash, 10, 8))} · SHA-256 ${escapeHtml(short(item.contentHash, 10, 8))}</small>${item.type === "safe" && item.structuredData ? `<small>Threshold ${escapeHtml(item.structuredData.threshold)} of ${escapeHtml(item.structuredData.owners.length)} owners · ${escapeHtml(item.structuredData.version || "Safe version not reported")}</small>` : ""}${item.type === "safe_onchain" && item.structuredData ? `<small>Provider ${escapeHtml(item.structuredData.provider)} · Ethereum block ${escapeHtml(item.structuredData.blockNumber)} (${escapeHtml(short(item.structuredData.blockHash, 10, 8))}) · threshold ${escapeHtml(item.structuredData.threshold)} of ${escapeHtml(item.structuredData.owners.length)} owners</small>` : ""}${item.type === "onchain" && item.structuredData ? `<small>${escapeHtml(item.structuredData.amountEth)} ETH · ${escapeHtml(item.structuredData.status)} · block ${escapeHtml(item.structuredData.blockNumber)}</small>` : ""}</div>`; }).join("")}
      <div class="due-priority"><span>Review priority: ${escapeHtml(titleCase(assessment.reviewPriority))}</span><p>${escapeHtml(assessment.reviewPriorityExplanation)}</p><small>Review priority identifies where human attention may be useful. It is not a voting recommendation.</small></div>
      <p class="due-consensus">${isV3 ? assessment.assessmentSchemaVersion === "3.3" ? "Independent validators retrieved the bounded sources and derived matching decision-bearing structured fields. Each external evidence record states its authority and verification method." : assessment.assessmentSchemaVersion === "3.2" ? "Validators independently retrieved the proposal and checked the fixed Ethereum RPC providers against one pinned block, then derived matching structured facts. RPC and explorer data are provider-reported secondary evidence, not cryptographic state proofs." : "Validators independently retrieved the proposal and, when applicable, the fixed Safe and Ethereum transaction-explorer sources, then derived matching structured facts. Safe and explorer data are provider-sourced secondary evidence, not cryptographic inclusion proofs." : "Validators independently retrieved the proposal and accepted source-grounded material facts."} Consensus validates the process; it does not eliminate uncertainty or replace governance judgment.</p></div>`;
  }

  function renderRecord(proposal) {
    $("[data-record-kicker]").textContent = `${proposal.daoName} / ${proposal.space}`;
    $("[data-record-title]").textContent = proposal.title;
    $("[data-record-intro]").textContent = "Review the proposal's actions, available evidence, and what remains uncertain.";
    $("[data-record-facts]").innerHTML = [fact("Proposal status", titleCase(proposal.status)), fact("Voting ends", formatDate(proposal.votingEndsAt)), fact("Proposer", proposal.authorAddress), fact("Snapshot space", proposal.space)].join("");
    $("[data-record-body]").textContent = proposal.bodyText || "The canonical source contains no proposal body.";
    $(`[data-due-diligence]`).innerHTML = ["2", "3"].includes(proposal.assessmentVersion) && proposal.dueDiligence
      ? renderDueDiligence(proposal.dueDiligence, proposal.changesSincePreviousRevision ?? [])
      : proposal.riskLevel
        ? '<h3>Legacy risk assessment</h3><p>This record uses the earlier scoring model. Its score is not a probability or a mathematically derived measure. No v2 findings have been inferred from it.</p>'
        : `<h3>Due diligence: ${escapeHtml(assessmentLabel(proposal.assessmentStatus))}</h3><p>${escapeHtml(assessmentExplanation(proposal.assessmentStatus))} No assessment claim is shown before finalization.</p>`;
    const accepted = proposal.assessmentStatus === "finalized";
    const score = proposal.riskScore ?? "—";
    const transactionUrl = proposal.transactionHash ? `https://explorer-studio.genlayer.com/tx/${proposal.transactionHash}` : undefined;
    const isDueDiligence = ["2", "3"].includes(proposal.assessmentVersion) && proposal.dueDiligence;
    const versionLabel = isDueDiligence ? `${titleCase(proposal.dueDiligence.reviewPriority)} review priority · v${proposal.assessmentVersion}` : proposal.riskLevel ? "Legacy risk assessment" : "No accepted assessment";
    $("[data-record-evidence]").innerHTML = `<h3>Evidence & provenance</h3><div class="verdict"><strong>${escapeHtml(versionLabel)}</strong><span>${escapeHtml(isDueDiligence ? `${proposal.dueDiligence.findings.length} findings · ${proposal.dueDiligence.materialClaims.length} claims` : proposal.riskLevel ? `Historical score: ${score}/100 (not mathematically interpretable)` : "Awaiting assessment")}</span></div><ol class="proof-steps"><li>Canonical source found</li><li>Proposal material indexed</li><li>${accepted ? "Assessment accepted" : `Assessment ${assessmentLabel(proposal.assessmentStatus).toLowerCase()}`}</li></ol><div class="evidence-list">${evidenceItem("Source", "Open Snapshot proposal", proposal.canonicalUrl)}${evidenceItem("Proposer", short(proposal.authorAddress))}${evidenceItem("Revision", short(proposal.revisionHash, 8, 6))}${evidenceItem("Transaction", short(proposal.transactionHash, 8, 6), transactionUrl)}${evidenceItem("Network", proposal.transactionHash ? "GenLayer Studionet" : "—")}${evidenceItem("Consensus", isDueDiligence ? proposal.assessmentVersion === "3" ? "Independent structured derivation" : "Source-grounded material facts" : proposal.consensusState ? titleCase(proposal.consensusState) : "—")}</div>${transactionUrl ? `<a class="button button-ink" href="${escapeHtml(transactionUrl)}" target="_blank" rel="noreferrer">View transaction ↗</a>` : ""}`;
  }

  async function openRecord(canonicalId) {
    const dialog = $("[data-record-dialog]");
    $("[data-public-record]").hidden = true;
    $("[data-record-loading]").hidden = false;
    dialog.showModal(); document.body.classList.add("dialog-open");
    try {
      const payload = await requestJson(`${API}/v1/proposals/${encodeURIComponent(canonicalId)}`);
      renderRecord(payload.data);
      $("[data-record-loading]").hidden = true;
      $("[data-public-record]").hidden = false;
    } catch (error) { $("[data-record-loading]").textContent = `Public record unavailable: ${error.message}`; }
  }

  function closeDialog(dialog) { dialog.close(); document.body.classList.remove("dialog-open"); }

  function setupDelegatedActions() {
    $$("dialog").forEach((dialog) => dialog.addEventListener("close", () => {
      if (!$("dialog[open]")) document.body.classList.remove("dialog-open");
    }));
    document.addEventListener("click", (event) => {
      const trigger = event.target.closest("[data-open-proposal]");
      if (trigger) openRecord(trigger.dataset.openProposal);
    });
    $("[data-record-close]").addEventListener("click", () => closeDialog($("[data-record-dialog]")));
    $("[data-record-dialog]").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeDialog(event.currentTarget); });
  }

  function setupFilters() {
    const searchInputs = $$("[data-search]"), indexSearch = $("[data-filter-form] [data-search]");
    $("[data-filter-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      state.search = indexSearch.value;
      state.filters = { space: $("[data-filter-dao]").value, status: $("[data-filter-status]").value, assessment: $("[data-filter-assessment]").value };
      loadProposals(false, state.search ? 100 : 24);
    });
    searchInputs.forEach((input) => input.addEventListener("input", () => {
      state.search = input.value;
      searchInputs.forEach((searchInput) => { if (searchInput !== input) searchInput.value = input.value; });
      renderProposals();
    }));
    $("[data-header-search]").addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      state.search = event.currentTarget.value;
      loadProposals(false, state.search ? 100 : 24);
      $("#proposals").scrollIntoView({ behavior: "smooth" });
    });
    $("[data-load-more]").addEventListener("click", () => loadProposals(true));
  }

  function setupNavigation() {
    const toggle = $("[data-nav-toggle]"), nav = $("[data-nav]");
    toggle.addEventListener("click", () => { const open = nav.classList.toggle("is-open"); toggle.setAttribute("aria-expanded", String(open)); toggle.setAttribute("aria-label", open ? "Close navigation" : "Open navigation"); });
    $$("a", nav).forEach((link) => link.addEventListener("click", () => { nav.classList.remove("is-open"); toggle.setAttribute("aria-expanded", "false"); }));
  }

  function setupWallet() {
    const dialog = $("[data-wallet-dialog]"), feedback = $("[data-wallet-feedback]"), label = $("[data-wallet-label]");
    $("[data-wallet-button]").addEventListener("click", () => { dialog.showModal(); document.body.classList.add("dialog-open"); });
    ["[data-wallet-close]", "[data-wallet-cancel]"].forEach((selector) => $(selector).addEventListener("click", () => closeDialog(dialog)));
    $("[data-wallet-confirm]").addEventListener("click", async () => {
      feedback.textContent = "Checking for a browser wallet…";
      if (!window.ethereum?.request) { feedback.innerHTML = 'No browser wallet was detected. You can continue using every public QuorumX feature without one.'; return; }
      try {
        const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
        if (!accounts?.[0]) throw new Error("No account was selected");
        label.textContent = short(accounts[0]); feedback.textContent = `Connected locally as ${short(accounts[0])}. No signature or transaction was requested.`;
        setTimeout(() => closeDialog(dialog), 900);
      } catch (error) { feedback.textContent = `Connection was not completed: ${error.message}`; }
    });
    if (window.ethereum?.on) window.ethereum.on("accountsChanged", (accounts) => { label.textContent = accounts?.[0] ? short(accounts[0]) : "Connect wallet"; });
  }

  function setupParticles() {
    const canvas = $("#dao-particles"); if (!canvas) return;
    const context = canvas.getContext("2d"), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const marks = [
      { src: "assets/balancer.webp", center: .40, mode: "dark" },
      { src: "assets/safe.webp", center: .55, mode: "dark" },
      { src: "assets/arbitrum.webp", center: .70, mode: "arbitrum" },
      { src: "assets/ens.webp", center: .85, mode: "light" },
    ];
    let cloud = [], logoParticles = [], logoMasks = [], frame = 0, width = 0, height = 0;

    function normalRandom() {
      return Math.sqrt(-2 * Math.log(Math.max(Math.random(), .0001))) * Math.cos(Math.PI * 2 * Math.random());
    }

    function sampleLogo(mark) {
      return new Promise((resolve) => {
        const image = new Image();
        image.onload = () => {
          const sampleCanvas = document.createElement("canvas");
          sampleCanvas.width = sampleCanvas.height = 160;
          const sampleContext = sampleCanvas.getContext("2d", { willReadFrequently: true });
          sampleContext.drawImage(image, 0, 0, 160, 160);
          const pixels = sampleContext.getImageData(0, 0, 160, 160).data;
          const points = [];
          for (let y = 0; y < 160; y += 2) for (let x = 0; x < 160; x += 2) {
            const offset = (y * 160 + x) * 4, red = pixels[offset], green = pixels[offset + 1], blue = pixels[offset + 2];
            const luminance = .2126 * red + .7152 * green + .0722 * blue;
            const isMark = mark.mode === "dark"
              ? luminance < 86
              : mark.mode === "arbitrum"
                ? (x - 80) ** 2 + (y - 80) ** 2 < 68 ** 2 && luminance > 112 && luminance < 250
                : Math.hypot(255 - red, 255 - green, 255 - blue) > 38;
            if (isMark) points.push({ x: x - 80, y: y - 80 });
          }
          resolve(points);
        };
        image.onerror = () => resolve([]);
        image.src = mark.src;
      });
    }

    function placeLogos() {
      logoParticles = [];
      logoMasks.forEach((mask, markIndex) => {
        if (!mask.length) return;
        const mark = marks[markIndex], mobile = width < 820, centers = mobile ? [.13, .38, .63, .88] : marks.map((item) => item.center);
        const count = 680, scale = Math.min(width * (mobile ? .18 : .095), mobile ? 90 : 132) / 160;
        for (let index = 0; index < count; index += 1) {
          const point = mask[Math.floor(index * mask.length / count) % mask.length];
          const targetX = width * centers[markIndex] + point.x * scale;
          const targetY = height * (mobile ? .73 : .41) + point.y * scale;
          logoParticles.push({ x: reduced ? targetX : Math.random() * width, y: reduced ? targetY : Math.random() * height, targetX, targetY, speed: .055 + Math.random() * .025, phase: Math.random() * Math.PI * 2, size: .7 + Math.random() * 1.25 });
        }
      });
    }

    function resize() {
      const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
      const nextWidth = Math.round(rect.width), nextHeight = Math.round(rect.height);
      if (nextWidth === width && nextHeight === height && cloud.length) return;
      width = nextWidth; height = nextHeight; canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio,0,0,ratio,0,0);
      cloud = Array.from({ length: reduced ? 3000 : 5600 }, () => {
        const x = width * (.19 + Math.random() * .82), progress = x / width;
        const centerY = height * (.37 + .055 * Math.sin(progress * 7.2) + .02 * Math.sin(progress * 15.5));
        const y = centerY + normalRandom() * height * .085;
        const nearestMark = Math.min(...marks.map((mark) => Math.abs(progress - mark.center)));
        return { x, y, phase: Math.random() * Math.PI * 2, size: .45 + Math.random() * (nearestMark < .055 ? 2.4 : 1.5), opacity: .25 + Math.random() * .5 };
      });
      placeLogos();
    }

    function draw(time = 0) {
      context.clearRect(0, 0, width, height);
      context.globalCompositeOperation = "lighter";
      for (const particle of cloud) {
        const drift = reduced ? 0 : Math.sin(time * .00018 + particle.phase) * 5;
        context.globalAlpha = particle.opacity * (.72 + .28 * Math.sin(time * .0003 + particle.phase));
        context.fillStyle = "#c88e30";
        context.beginPath(); context.arc(particle.x + drift, particle.y + drift * .35, particle.size, 0, Math.PI * 2); context.fill();
      }
      for (const mark of marks) {
        const centerX = width * mark.center, centerY = height * (width < 820 ? .73 : .41);
        const glow = context.createRadialGradient(centerX, centerY, 2, centerX, centerY, Math.min(width * .12, 172));
        glow.addColorStop(0, "rgba(215, 151, 43, .20)"); glow.addColorStop(1, "rgba(215, 151, 43, 0)");
        context.globalAlpha = 1; context.fillStyle = glow; context.fillRect(centerX - width * .15, centerY - height * .34, width * .3, height * .68);
      }
      for (const particle of logoParticles) {
        if (!reduced) {
          particle.x += (particle.targetX - particle.x) * particle.speed;
          particle.y += (particle.targetY - particle.y) * particle.speed;
        }
        const shimmer = reduced ? 1 : .82 + .18 * Math.sin(time * .001 + particle.phase);
        context.globalAlpha = shimmer; context.fillStyle = "#f4c65f";
        context.beginPath(); context.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2); context.fill();
      }
      context.globalAlpha = 1; context.globalCompositeOperation = "source-over";
      if (!reduced) frame = requestAnimationFrame(draw);
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); draw();
    Promise.all(marks.map(sampleLogo)).then((masks) => { logoMasks = masks; placeLogos(); if (!reduced) { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); } else draw(); });
    window.addEventListener("pagehide", () => { cancelAnimationFrame(frame); observer.disconnect(); }, { once: true });
  }

  function init() {
    setupNavigation(); setupWallet(); setupFilters(); setupDelegatedActions(); setupParticles();
    Promise.allSettled([loadSources(), loadAttention(), loadProposals(), loadAssessments()]);
  }

  return { init, buildProposalQuery, proposalMatchesSearch, daysUntil, short, safeHttpUrl,
    assessmentLabel, assessmentSignal, renderDueDiligence, sourceCard };
});
