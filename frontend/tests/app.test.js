const {
  assessmentLabel,
  buildProposalQuery,
  daysUntil,
  proposalMatchesSearch,
  safeHttpUrl,
  short,
  assessmentSignal,
  renderDueDiligence,
  resolveApiBase,
  proposalPath,
  isCurrentRequest,
  mergeUniqueProposals,
  particleBudget,
} = require("../app.js");
const { readFileSync } = require("node:fs");
const path = require("node:path");

describe("QuorumX frontend helpers", () => {
  test("uses an injected local API base and otherwise defaults to production", () => {
    expect(resolveApiBase({ QUORUMX_API_BASE: "/local-api/" })).toBe("/local-api");
    expect(resolveApiBase({})).toBe("/api");
  });
  test("builds bounded API queries from supported filters", () => {
    expect(buildProposalQuery({ status: "active", dao: "SafeDAO", q: "Serendipity", sort: "priority", ignored: "no" }, "opaque"))
      .toBe("/api/v1/proposals?limit=24&status=active&dao=SafeDAO&q=Serendipity&sort=priority&cursor=opaque");
    expect(proposalPath("snapshot:space/proposal 1")).toBe("/proposals/snapshot%3Aspace%2Fproposal%201");
  });

  test("matches proposal searches without case sensitivity", () => {
    const proposal = { title: "SEP 56 Treasury Policy", daoName: "SafeDAO", authorAddress: "0xABCD" };
    expect(proposalMatchesSearch(proposal, "treasury")).toBe(true);
    expect(proposalMatchesSearch(proposal, "safedao")).toBe(true);
    expect(proposalMatchesSearch(proposal, "0xabcd")).toBe(true);
    expect(proposalMatchesSearch(proposal, "balancer")).toBe(false);
  });

  test("late Mirage success or error cannot replace the current Ember request", async () => {
    let generation = 0, visible = "", error = "";
    let releaseMirage;
    const mirage = new Promise((resolve) => { releaseMirage = resolve; });
    const run = async (result) => {
      const requestGeneration = ++generation;
      try {
        const value = await result;
        if (isCurrentRequest(generation, requestGeneration)) visible = value;
      } catch (failure) {
        if (isCurrentRequest(generation, requestGeneration)) error = failure.message;
      }
    };
    const requestA = run(mirage);
    await run(Promise.resolve("Ember"));
    releaseMirage("Mirage");
    await requestA;
    expect({ visible, error }).toEqual({ visible: "Ember", error: "" });

    let rejectLate;
    const lateFailure = new Promise((resolve, reject) => { rejectLate = reject; });
    const staleError = run(lateFailure);
    await run(Promise.resolve("Ember remains"));
    rejectLate(new Error("Mirage offline"));
    await staleError;
    expect({ visible, error }).toEqual({ visible: "Ember remains", error: "" });
  });

  test("reused pagination rows are de-duplicated by canonical identity", () => {
    expect(mergeUniqueProposals(
      [{ canonicalId: "Mirage", title: "old" }],
      [{ canonicalId: "Mirage", title: "new" }, { canonicalId: "Ember", title: "Ember" }],
    )).toEqual([{ canonicalId: "Mirage", title: "new" }, { canonicalId: "Ember", title: "Ember" }]);
  });

  test("uses bounded particle budgets for mobile, low-power, desktop, and reduced motion", () => {
    expect(particleBudget(375, false, 8)).toEqual({ cloud: 0, logo: 0, fps: 0 });
    expect(particleBudget(1280, false, 2)).toEqual({ cloud: 0, logo: 0, fps: 0 });
    expect(particleBudget(1280, false, 8)).toEqual({ cloud: 2000, logo: 300, fps: 30 });
    expect(particleBudget(1280, true, 8)).toEqual({ cloud: 0, logo: 0, fps: 0 });
  });

  test("ships stable accessible loading regions and the correct skip target", () => {
    const html = readFileSync(path.join(__dirname, "..", "index.html"), "utf8");
    expect(html).toContain('class="skip-link" href="#proposals">Skip to proposals</a>');
    expect(html).toContain('id="proposals" tabindex="-1"');
    expect(html).toContain('aria-labelledby="record-dialog-title"');
    expect(html).toContain('id="record-loading" data-record-loading role="status" aria-live="polite"');
    expect((html.match(/aria-busy="true"/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  test("contains long Whimsy content and exposes record tabs at narrow widths", () => {
    const css = readFileSync(path.join(__dirname, "..", "styles.css"), "utf8");
    expect(css).toMatch(/\.record-tabs[^}]*overflow-x: auto/);
    expect(css).toMatch(/\.proposal-copy[^}]*overflow-wrap: anywhere/);
    expect(css).toMatch(/:focus-visible \{ outline: 3px solid/);
  });

  test("calculates whole voting days remaining", () => {
    const now = Date.parse("2026-09-29T12:00:00Z");
    expect(daysUntil("2026-10-01T11:00:00Z", now)).toBe(2);
    expect(daysUntil(null, now)).toBeNull();
  });

  test("allows only HTTPS links", () => {
    expect(safeHttpUrl("https://snapshot.box/proposal/1")).toBe("https://snapshot.box/proposal/1");
    expect(safeHttpUrl("http://example.com")).toBe("#");
    expect(safeHttpUrl("javascript:alert(1)")).toBe("#");
    expect(safeHttpUrl("not a URL")).toBe("#");
  });

  test("presents assessment and compact identity labels", () => {
    expect(assessmentLabel("finalized")).toBe("Accepted");
    expect(assessmentLabel("in_progress")).toBe("In Progress");
    expect(assessmentLabel()).toBe("Not assessed");
    expect(short("0x1234567890abcdef")).toBe("0x1234…cdef");
  });

  test("demotes legacy scores and explains v2 findings without vote advice", () => {
    expect(assessmentSignal({ riskLevel: "high", riskScore: 78 })).toBe("Legacy risk assessment");
    expect(assessmentSignal({ assessmentVersion: "2", reviewPriority: "high", findingCount: 2 }))
      .toBe("High review · 2 findings");
    const html = renderDueDiligence({
      overview: { purpose: "Transfer 5M ARB", requestedActions: ["Transfer 5M ARB"],
        assetsAffected: ["ARB"], permissionsChanged: [], controlChanges: [] },
      evidence: [{ id: "e1", locator: "https://snapshot.box/proposal/p1", description: "Proposal §4",
        contentHash: "a".repeat(64) }],
      materialClaims: [{ id: "c1", claim: "200k users", status: "unverified", explanation: "No independent evidence",
        sourceExcerpt: "200k users", confidence: "low", claimScope: "external_factual", evidence: ["e1"] }],
      findings: [{ id: "f1", title: "Treasury transfer", sourceExcerpt: "5M ARB", observation: "5M ARB moves", whyItMatters: "Control changes",
        severity: "high", confidence: "medium", evidence: ["e1"], existingSafeguards: ["3/5 Safe"],
        missingSafeguards: ["No clawback identified"], reversible: false,
        consensus: { state: "accepted", method: "source_grounded_material_facts_v2" } }],
      executionMap: [{ id: "s1", action: "Transfer 5M ARB", asset: "ARB", amount: "5000000", reversible: false,
        evidence: ["e1"] }],
      unresolvedQuestions: [{ id: "q1", question: "Who verifies milestones?", whyItMatters: "Funds may be disbursed" }],
      reviewPriority: "high", reviewPriorityExplanation: "Large treasury transfer.",
    }, [{ field: "Token amounts mentioned", previousValue: "3M ARB", currentValue: "5M ARB",
      significance: "material", explanation: "Text changed" }]);
    expect(html).toContain("No clawback identified");
    expect(html).toContain("Source passage");
    expect(html).toContain("Consensus accepted");
    expect(html).toContain("200k users");
    expect(html).toContain("3M ARB");
    expect(html).toContain("not a voting recommendation");
    expect(html).not.toContain("78/100");
  });

  test("escapes untrusted proposal and evidence text in due diligence", () => {
    const html = renderDueDiligence({
      overview: { purpose: '<img src=x onerror=alert(1)>', requestedActions: ["Review"],
        assetsAffected: [], permissionsChanged: [], controlChanges: [] },
      evidence: [], materialClaims: [], findings: [], executionMap: [], unresolvedQuestions: [],
      reviewPriority: "low", reviewPriorityExplanation: "No material issue identified.",
    });
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img src=x");
  });
});
