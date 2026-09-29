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
  const riskClass = (risk) => ["low", "medium", "high"].includes(risk) ? `badge-${risk}` : "risk-none";
  const assessmentLabel = (status) => status === "finalized" ? "Accepted" : status ? titleCase(status) : "Not assessed";

  function buildProposalQuery(filters = {}, cursor) {
    const params = new URLSearchParams({ limit: "24" });
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
    const haystack = [proposal.title, proposal.daoName, proposal.space, proposal.authorAddress, proposal.canonicalId].join(" ").toLowerCase();
    return haystack.includes(search.trim().toLowerCase());
  }

  function proposalRow(proposal) {
    const risk = proposal.riskLevel ? `${titleCase(proposal.riskLevel)} · ${proposal.riskScore}` : "—";
    return `<tr>
      <td><button class="proposal-title-button" type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}">${escapeHtml(proposal.title)}</button></td>
      <td><span class="dao-cell"><img src="${escapeHtml(safeHttpUrl(proposal.daoLogoUrl))}" alt="" loading="lazy">${escapeHtml(proposal.daoName)}</span></td>
      <td><span class="badge ${proposal.status === "active" ? "badge-active" : ""}">${escapeHtml(titleCase(proposal.status))}</span></td>
      <td><span class="${riskClass(proposal.riskLevel)}">${escapeHtml(risk)}</span></td>
      <td><span class="badge ${proposal.assessmentStatus === "finalized" ? "badge-finalized" : ""}">${escapeHtml(assessmentLabel(proposal.assessmentStatus))}</span></td>
      <td>${escapeHtml(formatDate(proposal.votingEndsAt, { month: "short", day: "numeric", year: "numeric" }))}</td>
      <td><button class="proposal-title-button row-arrow" type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}" aria-label="Open ${escapeHtml(proposal.title)}">→</button></td>
    </tr>`;
  }

  function mobileProposal(proposal) {
    const risk = proposal.riskLevel ? `${titleCase(proposal.riskLevel)} · ${proposal.riskScore}` : "Not assessed";
    return `<article class="mobile-card"><button type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}"><span class="dao-cell"><img src="${escapeHtml(safeHttpUrl(proposal.daoLogoUrl))}" alt="">${escapeHtml(proposal.daoName)}</span><h3>${escapeHtml(proposal.title)}</h3><span class="mobile-card-meta"><span class="badge ${proposal.status === "active" ? "badge-active" : ""}">${escapeHtml(titleCase(proposal.status))}</span><span class="badge ${riskClass(proposal.riskLevel)}">${escapeHtml(risk)}</span><span class="badge">Ends ${escapeHtml(formatDate(proposal.votingEndsAt, { month: "short", day: "numeric" }))}</span></span></button></article>`;
  }

  function renderProposals() {
    const visible = state.proposals.filter((proposal) => proposalMatchesSearch(proposal, state.search));
    $("[data-proposals]").innerHTML = visible.length ? visible.map(proposalRow).join("") : '<tr><td colspan="7"><div class="empty-block">No proposals match these filters.</div></td></tr>';
    $("[data-mobile-proposals]").innerHTML = visible.length ? visible.map(mobileProposal).join("") : '<div class="empty-block">No proposals match these filters.</div>';
    $("[data-index-status]").textContent = `${visible.length} proposal${visible.length === 1 ? "" : "s"} shown · Live data from api.quorumx.dev`;
    $("[data-load-more]").hidden = !state.nextCursor;
  }

  async function loadProposals(append = false) {
    const target = $("[data-index-status]");
    target.textContent = append ? "Loading more proposals…" : "Refreshing the public index…";
    try {
      const payload = await requestJson(buildProposalQuery(state.filters, append ? state.nextCursor : undefined));
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
    const risk = proposal.riskLevel ? `${titleCase(proposal.riskLevel)} risk · ${proposal.riskScore}/100` : "Awaiting assessment";
    const reason = proposal.recommendation === "manual_review"
      ? "GenLayer’s accepted assessment recommends human review before governance participants rely on this proposal’s assumptions or implementation plan."
      : "This active proposal is assessment-eligible and remains within its public voting window.";
    return `<article class="attention-card ${primary ? "is-primary" : ""}"><p class="dao-line">${escapeHtml(proposal.daoName)} · ${escapeHtml(proposal.space)}</p><h3>${escapeHtml(proposal.title)}</h3><p class="attention-reason">${escapeHtml(reason)}</p><div class="attention-meta"><span class="badge badge-active">${escapeHtml(titleCase(proposal.status))}</span><span class="badge ${riskClass(proposal.riskLevel)}">${escapeHtml(risk)}</span><span class="badge">${escapeHtml(deadline)}</span></div><button type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}">Why this needs review →</button></article>`;
  }

  async function loadAttention() {
    const target = $("[data-attention]");
    try {
      const payload = await requestJson(buildProposalQuery({ status: "active" }));
      const ranked = payload.data.sort((a, b) => (b.riskScore ?? -1) - (a.riskScore ?? -1) || (daysUntil(a.votingEndsAt) ?? 999) - (daysUntil(b.votingEndsAt) ?? 999)).slice(0, 2);
      target.innerHTML = ranked.length ? ranked.map((proposal, index) => attentionCard(proposal, index === 0)).join("") : '<div class="empty-block">No active proposal currently requires priority review.</div>';
    } catch (error) { target.innerHTML = `<div class="error-block">Priority queue unavailable: ${escapeHtml(error.message)}</div>`; }
  }

  function assessmentRow(proposal) {
    return `<article class="assessment-row"><button type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}">${escapeHtml(proposal.title)}<small>${escapeHtml(proposal.daoName)}</small></button><span class="${riskClass(proposal.riskLevel)}">${escapeHtml(titleCase(proposal.riskLevel))} · ${escapeHtml(proposal.riskScore)}</span><span>${escapeHtml(titleCase(proposal.recommendation))}</span><span>${escapeHtml(formatDate(proposal.assessedAt))}</span><button class="proposal-title-button row-arrow" type="button" data-open-proposal="${escapeHtml(proposal.canonicalId)}" aria-label="Open assessment">→</button></article>`;
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
    return `<article class="dao-card"><img src="${escapeHtml(safeHttpUrl(source.logoUrl))}" alt="${escapeHtml(source.displayName)} logo" loading="lazy"><h3>${escapeHtml(source.displayName)}</h3><p>${escapeHtml(source.ecosystems.join(" · "))}</p><dl><dt>Snapshot space</dt><dd>${escapeHtml(space)}</dd><dt>Assessment budget</dt><dd>${escapeHtml(source.dailyAssessmentBudget)}/day</dd><dt>Last indexed</dt><dd>${escapeHtml(formatDate(source.lastSucceededAt, { month: "short", day: "numeric" }))}</dd></dl><a href="${escapeHtml(safeHttpUrl(source.homepageUrl))}">Visit governance source ↗</a></article>`;
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

  function renderRecord(proposal) {
    $("[data-record-kicker]").textContent = `${proposal.daoName} / ${proposal.space}`;
    $("[data-record-title]").textContent = proposal.title;
    $("[data-record-intro]").textContent = "Canonical proposal material with its current voting state and latest QuorumX assessment evidence.";
    $("[data-record-facts]").innerHTML = [fact("Proposal status", titleCase(proposal.status)), fact("Voting ends", formatDate(proposal.votingEndsAt)), fact("Proposer", proposal.authorAddress), fact("Snapshot space", proposal.space)].join("");
    $("[data-record-body]").textContent = proposal.bodyText || "The canonical source contains no proposal body.";
    const accepted = proposal.assessmentStatus === "finalized";
    const score = proposal.riskScore ?? "—";
    const transactionUrl = proposal.transactionHash ? `https://explorer-studio.genlayer.com/tx/${proposal.transactionHash}` : undefined;
    $("[data-record-evidence]").innerHTML = `<h3>Risk assessment</h3><div class="verdict"><strong>${escapeHtml(proposal.riskLevel ? `${titleCase(proposal.riskLevel)} · ${score}/100` : "Not assessed")}</strong><span>${escapeHtml(proposal.recommendation ? titleCase(proposal.recommendation) : "No recommendation")}</span></div><ol class="proof-steps"><li>Canonical source found</li><li>Proposal material indexed</li><li>${accepted ? "Assessment accepted" : `Assessment ${assessmentLabel(proposal.assessmentStatus).toLowerCase()}`}</li></ol><div class="evidence-list">${evidenceItem("Source", "Open Snapshot proposal", proposal.canonicalUrl)}${evidenceItem("Proposer", short(proposal.authorAddress))}${evidenceItem("Revision", short(proposal.revisionHash, 8, 6))}${evidenceItem("Transaction", short(proposal.transactionHash, 8, 6), transactionUrl)}${evidenceItem("Network", proposal.transactionHash ? "GenLayer Studionet" : "—")}${evidenceItem("Consensus", proposal.consensusState ? titleCase(proposal.consensusState) : "—")}</div>${transactionUrl ? `<a class="button button-ink" href="${escapeHtml(transactionUrl)}" target="_blank" rel="noreferrer">View transaction ↗</a>` : ""}`;
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
    $("[data-filter-form]").addEventListener("submit", (event) => {
      event.preventDefault();
      state.search = $("[data-search]").value;
      state.filters = { space: $("[data-filter-dao]").value, status: $("[data-filter-status]").value, assessment: $("[data-filter-assessment]").value };
      loadProposals();
    });
    $("[data-search]").addEventListener("input", (event) => { state.search = event.target.value; renderProposals(); });
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

  function logoPoint(kind, t, random) {
    const angle = t * Math.PI * 2;
    if (kind === 0) {
      const row = Math.floor(random * 3), radiusX = 28 - row * 4;
      return { x: Math.cos(angle) * radiusX, y: (row - 1) * 18 + Math.sin(angle) * 6 };
    }
    if (kind === 1) {
      const block = Math.floor(random * 4), radius = Math.sqrt(Math.random()) * 10;
      const centers = [[-15,-15],[15,-15],[-15,15],[15,15]];
      return { x: centers[block][0] + Math.cos(angle) * radius, y: centers[block][1] + Math.sin(angle) * radius };
    }
    if (kind === 2) {
      const side = Math.floor(random * 6);
      const points = [[0,-32],[28,-16],[28,16],[0,32],[-28,16],[-28,-16],[0,-32]];
      const from = points[side], to = points[side + 1];
      return { x: from[0] + (to[0] - from[0]) * t, y: from[1] + (to[1] - from[1]) * t };
    }
    const x = Math.random() * 2 - 1;
    return { x: x * 31, y: (Math.random() * 2 - 1) * (1 - Math.abs(x)) * 38 };
  }

  function setupParticles() {
    const canvas = $("#dao-particles"); if (!canvas) return;
    const context = canvas.getContext("2d"), reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let particles = [], frame = 0, width = 0, height = 0;
    function resize() {
      const rect = canvas.getBoundingClientRect(), ratio = Math.min(devicePixelRatio || 1, 2);
      const nextWidth = Math.round(rect.width), nextHeight = Math.round(rect.height);
      if (nextWidth === width && nextHeight === height && particles.length) return;
      width = nextWidth; height = nextHeight; canvas.width = width * ratio; canvas.height = height * ratio; context.setTransform(ratio,0,0,ratio,0,0);
      particles = Array.from({ length: reduced ? 560 : 1200 }, (_, index) => {
        const kind = index % 4, random = Math.random(), point = logoPoint(kind, Math.random(), random);
        return { kind, tx: width * ((kind + .5) / 4) + point.x * 1.35, ty: height * .47 + point.y * 1.35, x: Math.random()*width, y: Math.random()*height, speed: .065+Math.random()*.035, phase: Math.random()*Math.PI*2, size: .8+Math.random()*1.2 };
      });
    }
    function draw(time = 0) {
      context.clearRect(0,0,width,height); context.fillStyle = "#f0c766";
      for (const particle of particles) {
        particle.x += (particle.tx - particle.x) * particle.speed; particle.y += (particle.ty - particle.y) * particle.speed;
        const drift = reduced ? 0 : Math.sin(time*.0005 + particle.phase)*2.2;
        context.globalAlpha = .58 + .4*Math.abs(Math.sin(time*.00035 + particle.phase)); context.beginPath(); context.arc(particle.x+drift,particle.y,particle.size,0,Math.PI*2); context.fill();
      }
      context.globalAlpha = 1; if (!reduced) frame = requestAnimationFrame(draw);
    }
    const observer = new ResizeObserver(resize); observer.observe(canvas); resize(); draw();
    window.addEventListener("pagehide", () => { cancelAnimationFrame(frame); observer.disconnect(); }, { once: true });
  }

  function init() {
    setupNavigation(); setupWallet(); setupFilters(); setupDelegatedActions(); setupParticles();
    Promise.allSettled([loadSources(), loadAttention(), loadProposals(), loadAssessments()]);
  }

  return { init, buildProposalQuery, proposalMatchesSearch, daysUntil, short, safeHttpUrl, assessmentLabel };
});
