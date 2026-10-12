const { renderDueDiligence } = require("../app.js");
const { readFileSync } = require("node:fs");
const path = require("node:path");

describe("source excerpt readability", () => {
  test("preserves a stored excerpt exactly instead of reconstructing a truncated word", () => {
    const storedExcerpt = "After [BIP-925](https://forum.balancer.fi/t/bip-925-unwind-timeless-ve8020-bal-grant/7095), FeeDistributor rewar";
    const html = renderDueDiligence({
      assessmentVersion: "3", assessmentSchemaVersion: "3.3", overview: { purpose: "Review." },
      materialClaims: [{ id: "c1", claim: "A stored claim", claimScope: "proposal_action", proposalAssertion: true, status: "unverified", sourceExcerpt: storedExcerpt, explanation: "Source presence only.", confidence: "low", evidence: [] }],
      findings: [], unresolvedQuestions: [], executionMap: [], evidence: [], safeguardGaps: [], reviewPriority: "low", reviewPriorityExplanation: "No material consequence was established.",
    });

    expect(html).toContain("FeeDistributor rewar");
    expect(html).not.toContain("FeeDistributor rewards");
  });

  test("emits long technical source content intact for the shared responsive styles", () => {
    const longHash = `0x${"a".repeat(64)}`;
    const longUrl = `https://etherscan.io/tx/${longHash}`;
    const functionCall = `execute(address,uint256,bytes32)(${longHash},1000000000000000000,${longHash})`;
    const html = renderDueDiligence({
      assessmentVersion: "3", assessmentSchemaVersion: "3.3", overview: { purpose: "Review." },
      materialClaims: [{ id: "c1", claim: "Technical reference", claimScope: "proposal_action", proposalAssertion: true, status: "unverified", sourceExcerpt: `\`${functionCall}\`\n\n${longUrl}`, explanation: "Source presence only.", confidence: "low", evidence: [] }],
      findings: [], unresolvedQuestions: [], executionMap: [], evidence: [], safeguardGaps: [], reviewPriority: "low", reviewPriorityExplanation: "No material consequence was established.",
    });
    const css = readFileSync(path.join(__dirname, "../styles.css"), "utf8");

    expect(html).toContain(functionCall);
    expect(html).toContain(`href=\"${longUrl}\"`);
    expect(css).toContain(".source-markdown, .source-markdown > *, .due-item dl > dd, .due-evidence dl > dd, .evidence-item > *");
    expect(css).toContain("overflow-x: auto");
    expect(css).toContain("white-space: break-spaces");
  });
});
