const {
  assessmentLabel,
  buildProposalQuery,
  daysUntil,
  proposalMatchesSearch,
  safeHttpUrl,
  short,
  assessmentSignal,
  renderDueDiligence,
  sourceCard,
  particleLayout,
  particleOrigin,
  fallbackLogoMask,
  resolveLogoMasks,
  boundedPixelRatio,
  shouldSettleLogoOrigins,
} = require("../app.js");

describe("QuorumX frontend helpers", () => {
  describe("particle hero layout contract", () => {
    test.each([
      [890, 537, 1440, "desktop"],
      [1024, 500, 1024, "tablet"],
      [768, 500, 768, "mobile"],
      [390, 420, 390, "mobile"],
      [320, 420, 320, "mobile"],
    ])("selects a bounded %i px canvas within a %i px viewport", (width, height, viewportWidth, profile) => {
      const layout = particleLayout(width, height, false, viewportWidth);

      expect(layout.profile).toBe(profile);
      expect(layout.centerRatios).toEqual([0.125, 0.375, 0.625, 0.875]);
      expect(layout.centers).toHaveLength(4);
      expect(layout.centers.every((center) => center > 0 && center < width)).toBe(true);
      expect(layout.centers).toEqual([...layout.centers].sort((left, right) => left - right));
      expect(layout.logoY).toBeGreaterThan(0);
      expect(layout.logoY).toBeLessThan(height);
      expect(layout.logoScale).toBeGreaterThan(0);
      expect(layout.centers[0] - 80 * layout.logoScale).toBeGreaterThanOrEqual(layout.artworkStartX);
    });

    test("records bounded particle density for animated and reduced-motion layouts", () => {
      expect(particleLayout(890, 537, false, 1440).cloudParticleCount).toBe(7600);
      expect(particleLayout(890, 537, true, 1440).cloudParticleCount).toBe(4200);
      expect(particleLayout(890, 537, false, 1440).logoParticleCount).toBe(760);
    });

    test.each([[0, 690], [390, 0], [-1, 690], [390, -1]])
      ("defers particle initialization for invalid bounds %i by %i", (width, height) => {
        expect(particleLayout(width, height)).toBeNull();
      });

    test("places reduced-motion particles directly at their final targets", () => {
      expect(particleOrigin({ targetX: 120, targetY: 240, width: 390, height: 690, reducedMotion: true }))
        .toEqual({ x: 120, y: 240 });
    });

    test("uses the supplied random source for animated particle origins", () => {
      const values = [0.25, 0.75];
      expect(particleOrigin({ targetX: 120, targetY: 240, width: 400, height: 600,
        reducedMotion: false, random: () => values.shift() }))
        .toEqual({ x: 100, y: 450 });
    });

    test("provides four distinct bounded fallback DAO silhouettes", () => {
      const masks = [0, 1, 2, 3].map(fallbackLogoMask);

      masks.forEach((mask) => {
        expect(mask.length).toBeGreaterThanOrEqual(80);
        expect(mask.every(({ x, y }) => Number.isFinite(x) && Number.isFinite(y)
          && Math.abs(x) <= 80 && Math.abs(y) <= 80)).toBe(true);
      });
      expect(new Set(masks.map((mask) => JSON.stringify(mask.slice(0, 20)))).size).toBe(4);
    });

    test("uses sampled masks only when they contain valid points", () => {
      const sampled = [[{ x: 1, y: 2 }], [], [{ x: Number.NaN, y: 2 }], null];
      const resolved = resolveLogoMasks(sampled);

      expect(resolved[0]).toEqual(sampled[0]);
      expect(resolved.slice(1).every((mask) => mask.length >= 80)).toBe(true);
    });

    test.each([
      [undefined, 1], [Number.NaN, 1], [0, 1], [-1, 1], [1, 1], [1.5, 1.5], [4, 2],
    ])("bounds device pixel ratio %s to %s", (value, expected) => {
      expect(boundedPixelRatio(value)).toBe(expected);
    });

    test.each([
      [false, false, true],
      [false, true, false],
      [true, false, true],
      [true, true, true],
    ])("settles logo origins when reduced motion is %s and assets are ready is %s", (reducedMotion, assetsReady, expected) => {
      expect(shouldSettleLogoOrigins(reducedMotion, assetsReady)).toBe(expected);
    });
  });

  test("builds bounded API queries from supported filters", () => {
    expect(buildProposalQuery({ status: "active", dao: "SafeDAO", ignored: "no" }, "40"))
      .toBe("https://api.quorumx.dev/v1/proposals?limit=24&status=active&dao=SafeDAO&cursor=40");
  });

  test("matches proposal searches without case sensitivity", () => {
    const proposal = { title: "SEP 56 Treasury Policy", daoName: "SafeDAO", authorAddress: "0xABCD" };
    expect(proposalMatchesSearch(proposal, "treasury")).toBe(true);
    expect(proposalMatchesSearch(proposal, "safedao")).toBe(true);
    expect(proposalMatchesSearch(proposal, "0xabcd")).toBe(true);
    expect(proposalMatchesSearch(proposal, "balancer")).toBe(false);
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

  test("renders escaped source coverage and backlog state", () => {
    const html = sourceCard({ configuration: { space: "safe.eth" }, logoUrl: "javascript:bad",
      displayName: "<SafeDAO>", ecosystems: ["ethereum"], coverageState: "scanning", scanGeneration: 3,
      scanOffset: 50, backlogCount: 125, oldestBacklogAt: "2026-10-01T00:00:00Z", dailyAssessmentBudget: 1,
      lastSucceededAt: "2026-10-07T00:00:00Z", homepageUrl: "https://safe.global" });
    expect(html).toContain("Scanning · generation 3, offset 50");
    expect(html).toContain("125 queued");
    expect(html).toContain("&lt;SafeDAO&gt;");
    expect(html).not.toContain("javascript:bad");
  });

  test("presents assessment and compact identity labels", () => {
    expect(assessmentLabel("finalized")).toBe("Accepted");
    expect(assessmentLabel("in_progress")).toBe("In Progress");
    expect(assessmentLabel()).toBe("Not assessed");
    expect(short("0x1234567890abcdef")).toBe("0x1234…cdef");
  });

  test.each([
    ["indexed", "Indexed"], ["waiting_capacity", "Waiting for capacity"], ["processing", "Processing"],
    ["submitted", "Submitted"], ["retrying", "Retrying"], ["finalized", "Accepted"], ["unavailable", "Unavailable"],
  ])("renders the public lifecycle label for %s", (state, label) => {
    expect(assessmentLabel(state)).toBe(label);
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

  test("renders v3 secondary evidence and safeguard absence without overclaiming", () => {
    const html = renderDueDiligence({
      assessmentVersion: "3",
      overview: { purpose: "Transfer 5M ARB", requestedActions: ["Transfer 5M ARB"],
        assetsAffected: ["5M ARB"], permissionsChanged: [], controlChanges: [] },
      evidence: [
        { id: "proposal", type: "proposal", locator: "https://snapshot.box/p1", description: "Proposal",
          contentHash: "a".repeat(64), verificationScope: "validator_retrieved_proposal", authority: "primary" },
        { id: "safe-mainnet", type: "safe", locator: "https://api.safe.global/tx-service/eth/api/v1/safes/0x1111111111111111111111111111111111111111/",
          description: "Safe configuration", contentHash: "b".repeat(64),
          verificationScope: "validator_retrieved_external_source", authority: "secondary",
          structuredData: { address: "0x1111111111111111111111111111111111111111", threshold: 2,
            owners: ["0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"], version: "1.4.1" } },
      ],
      externalEvidenceState: "retrieved",
      materialClaims: [{ id: "c1", claim: "Safe threshold 2/2", status: "supported", explanation: "Matches retrieved config.",
        sourceExcerpt: "Safe threshold 2/2", counterExcerpt: "2/2 threshold", confidence: "medium", claimScope: "external_factual",
        evidence: ["proposal", "safe-mainnet"], verificationMethod: "safe_transaction_service_eth_mainnet_config_comparison" }],
      findings: [{ id: "f1", title: "Treasury action", sourceExcerpt: "Transfer 5M ARB", observation: "Transfer 5M ARB",
        whyItMatters: "Custody changes.", impact: "Later control is not established.", severity: "high", confidence: "medium",
        evidence: ["proposal"], existingSafeguards: [], safeguardGaps: [{ safeguard: "recovery", state: "not_identified",
          scope: "Complete validator-retrieved proposal", relatedActionIds: ["a1"], evidence: ["proposal"] }],
        humanDependencies: [], technicalDependencies: [], reversible: "unknown", uncertainty: "Bounded source.",
        consensus: { state: "accepted", method: "independent_structured_derivation_v3" } }],
      safeguardGaps: [{ safeguard: "recovery", state: "not_identified", scope: "Complete validator-retrieved proposal",
        relatedActionIds: ["a1"], evidence: ["proposal"] }],
      executionMap: [], unresolvedQuestions: [], reviewPriority: "high",
      reviewPriorityExplanation: "High review priority; human review remains advisory.",
    });
    expect(assessmentSignal({ assessmentVersion: "3", reviewPriority: "high", findingCount: 1 })).toBe("High review · 1 findings");
    expect(html).toContain("v3");
    expect(html).toContain("Secondary authority");
    expect(html).toContain("Provider-reported secondary evidence; not a cryptographic state/inclusion proof");
    expect(html).toContain("Not Identified");
    expect(html).toContain("Proposal claim");
    expect(html).toContain("Safe evidence: Retrieved");
    expect(html).not.toContain("on-chain verified");
  });

  test("renders v3.1 provider-verified claim separately from the proposal assertion", () => {
    const html = renderDueDiligence({
      assessmentVersion: "3", assessmentSchemaVersion: "3.1", externalEvidenceState: "retrieved",
      returnedFundsState: "retrieved",
      overview: { purpose: "Report returned ETH", requestedActions: ["Review the distribution"],
        assetsAffected: ["ETH"], permissionsChanged: [], controlChanges: [] },
      evidence: [
        { id: "proposal", type: "proposal", locator: "https://snapshot.box/p1", description: "Snapshot proposal",
          contentHash: "a".repeat(64), verificationScope: "validator_retrieved_proposal", authority: "primary" },
        { id: "return-tx-1", type: "onchain", locator: "https://eth.blockscout.com/tx/0x" + "1".repeat(64),
          description: "Blockscout-indexed Ethereum mainnet returned-fund transaction 1", contentHash: "b".repeat(64),
          verificationScope: "validator_retrieved_external_source", authority: "secondary",
          structuredData: { amountEth: "120.000000", status: "success", blockNumber: 123, transferType: "transaction_value" } },
      ],
      materialClaims: [{ id: "c1", claim: "The proposal reports 120 ETH returned to the DAO Safe in 1 transaction.",
        sourceExcerpt: "120 ETH", counterExcerpt: "Blockscout-reported transfer total 120 ETH.",
        claimScope: "external_factual", status: "supported", explanation: "Provider-reported transaction data matches the proposal row.",
        evidence: ["proposal", "return-tx-1"], confidence: "high", verificationMethod: "blockscout_mainnet_transfer_amount_comparison" }],
      findings: [], executionMap: [], unresolvedQuestions: [], safeguardGaps: [], changes: [],
      reviewPriority: "normal", reviewPriorityExplanation: "Normal review priority; human review remains advisory.",
    });
    expect(html).toContain("schema 3.1");
    expect(html).toContain("Returned-funds trace: Retrieved");
    expect(html).toContain("Proposal claim");
    expect(html).toContain("Provider-reported transaction data matches the proposal row.");
    expect(html).toContain("Secondary authority");
    expect(html).toContain("Provider-reported secondary evidence; not a cryptographic state/inclusion proof");
    expect(html).toContain("120.000000 ETH · success · block 123");
    expect(html).not.toContain("on-chain verified");
  });

  test("renders v3.2 pinned dual-RPC Safe evidence with provider-reported provenance", () => {
    const blockHash = "0x" + "d".repeat(64);
    const owners = ["0x2222222222222222222222222222222222222222", "0x3333333333333333333333333333333333333333"];
    const html = renderDueDiligence({
      assessmentVersion: "3", assessmentSchemaVersion: "3.2", externalEvidenceState: "retrieved",
      returnedFundsState: "not_attempted",
      overview: { purpose: "Check Safe configuration", requestedActions: ["Review Safe"],
        assetsAffected: [], permissionsChanged: [], controlChanges: [] },
      evidence: ["publicnode", "drpc"].map((provider) => ({
        id: `safe-rpc-${provider}`, type: "safe_onchain",
        locator: provider === "publicnode" ? "https://ethereum-rpc.publicnode.com" : "https://eth.drpc.org",
        description: `${provider} Safe state`, contentHash: "a".repeat(64),
        verificationScope: "validator_retrieved_external_source", authority: "secondary",
        structuredData: { provider, address: "0x1111111111111111111111111111111111111111", chainId: 1,
          blockNumber: 25_000_000, blockHash, threshold: 2, owners },
      })),
      materialClaims: [], findings: [], executionMap: [], unresolvedQuestions: [], safeguardGaps: [],
      reviewPriority: "low", reviewPriorityExplanation: "No material issue identified.",
    });
    expect(html).toContain("Dual-RPC Safe state check: Retrieved");
    expect(html).toContain("Provider publicnode · Ethereum block 25000000");
    expect(html).toContain("Provider drpc · Ethereum block 25000000");
    expect(html).toContain("not a cryptographic state/inclusion proof");
    expect(html).toContain("checked the fixed Ethereum RPC providers against one pinned block");
    expect(html).not.toContain("Safe Transaction Service sources");
  });

  test("renders schema 3.3 relationships, consequence fields, and inert unsafe locators", () => {
    const html = renderDueDiligence({ assessmentVersion: "3", assessmentSchemaVersion: "3.3",
      externalEvidenceState: "not_attempted", returnedFundsState: "not_attempted",
      overview: { purpose: "Transfer funds", requestedActions: ["Transfer 1M ARB"], assetsAffected: ["1M ARB"], permissionsChanged: [], controlChanges: [] },
      evidence: [{ id: "proposal", type: "proposal", locator: "javascript:alert(1)", description: "<img src=x onerror=alert(1)>",
        contentHash: "a".repeat(64), verificationScope: "validator_retrieved_proposal", authority: "primary" }],
      materialClaims: [{ id: "c1", claim: "Transfer 1M ARB", sourceExcerpt: "Transfer 1M ARB", counterExcerpt: "",
        claimScope: "proposal_action", status: "not_applicable", proposalAssertion: true,
        explanation: "Proposal assertion only.", evidence: ["proposal"], evidenceAuthority: ["primary"], confidence: "high", verificationMethod: "proposal_presence_only" }],
      safeguardGaps: [{ id: "sg1", safeguard: "recovery", state: "not_identified", scope: "reviewed material", evidence: ["proposal"] }],
      findings: [{ id: "f1", title: "Control moves", observation: "Transfer", sourceExcerpt: "Transfer 1M ARB", whyItMatters: "Custody changes.",
        impact: "Direct DAO control ends after transfer.", severity: "high", confidence: "medium", evidence: ["proposal"], existingSafeguards: [],
        safeguardGapIds: ["sg1"], humanDependencies: ["3 Safe signers"], technicalDependencies: ["Safe contract"], reversible: "unknown",
        uncertainty: "Later path not established.", consensus: { state: "accepted", method: "independent_structured_derivation_v3_3" } }],
      executionMap: [{ id: "s1", order: 1, action: "Transfer 1M ARB", actor: "DAO treasury", target: "Safe 0x123", amount: "1M", asset: "ARB",
        dependency: "3/5 approval", impact: "Subsequent path not established.", humanDependencies: ["Safe signers"], technicalDependencies: ["Safe contract"], reversible: "unknown", evidence: ["proposal"] }],
      unresolvedQuestions: [{ id: "q1", question: "Who approves?", whyItMatters: "Approval controls release.", evidenceGap: "Approver unknown.",
        relatedFindingIds: ["f1"], relatedClaimIds: ["c1"], relatedExecutionStepIds: ["s1"] }],
      reviewPriority: "high", reviewPriorityExplanation: "High human attention.",
    });
    expect(html).toContain("Not Identified in reviewed material");
    expect(html).toContain("DAO treasury");
    expect(html).toContain("3/5 approval");
    expect(html).toContain("Subsequent execution path not established");
    expect(html).toContain("derived matching decision-bearing structured fields");
    expect(html).toContain('href="#finding-f1"');
    expect(html).toContain('href="#claim-c1"');
    expect(html).toContain('href="#execution-s1"');
    expect(html).not.toContain('href="#"');
    expect(html).not.toContain("<img src=x");
  });
});
