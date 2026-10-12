const { readFileSync } = require("node:fs");
const path = require("node:path");
const { containsMarkdown, renderSourceMarkdown } = require("../markdown_renderer.js");
const { renderDueDiligence } = require("../app.js");

const bip933 = JSON.parse(readFileSync(path.join(__dirname, "../../fixtures/decision_ir/bip_933.json"), "utf8"));

describe("proposal Markdown rendering", () => {
  test("renders BIP-933 source Markdown and its forum, explorer, and execution PR links", () => {
    const html = renderSourceMarkdown(bip933.body);

    expect(html).toContain("<h1>TL;DR</h1>");
    expect(html).toContain("<strong>10,286.807445 USDC</strong>");
    expect(html).toContain("<code>withdrawBalances()</code>");
    expect(html).toContain('href="https://forum.balancer.fi/t/bip-925-unwind-timeless-ve8020-bal-grant/7095"');
    expect(html).toContain('href="https://etherscan.io/address/0x89f67f3054bfd662971854190dbc18dcabb416f6"');
    expect(html).toContain('href="https://github.com/balancer/multisig-ops/pull/2882"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("recognizes bare HTTPS Google Drive URLs without converting ordinary excerpts", () => {
    const drive = "Supporting report: https://drive.google.com/file/d/abc123/view";
    expect(containsMarkdown(drive)).toBe(true);
    expect(renderSourceMarkdown(drive)).toContain('href="https://drive.google.com/file/d/abc123/view"');
    expect(containsMarkdown("A plain source excerpt with no Markdown syntax.")).toBe(false);
  });

  test("supports headings, lists, quotes, emphasis, inline code, and fenced code", () => {
    const html = renderSourceMarkdown("## Heading\n\n- **bold** and *italic*\n\n> quoted\n\n`claimFees`\n\n```solidity\nclaimFees()\n```");
    expect(html).toContain("<h2>Heading</h2>");
    expect(html).toContain("<ul>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<code>claimFees</code>");
    expect(html).toContain("<pre><code class=\"language-solidity\">");
  });

  test("renders relevant due-diligence excerpts through the same safe renderer", () => {
    const html = renderDueDiligence({
      assessmentVersion: "3",
      assessmentSchemaVersion: "3.3",
      overview: { purpose: "Review source passages." },
      materialClaims: [{ id: "claim-1", claim: "Proposal links supporting material", claimScope: "proposal_action", proposalAssertion: true, status: "unverified", sourceExcerpt: "See [execution PR](https://github.com/balancer/multisig-ops/pull/2882).", explanation: "The proposal contains this link.", confidence: "low", evidence: [] }],
      findings: [{ id: "finding-1", title: "Linked source", severity: "low", confidence: "high", observation: "The proposal includes a link.", sourceExcerpt: "# Source\n\n[Forum](https://forum.balancer.fi/t/bip-925-unwind-timeless-ve8020-bal-grant/7095)", whyItMatters: "It is reviewable.", impact: "Not established.", existingSafeguards: [], reversible: "unknown", evidence: [] }],
      unresolvedQuestions: [], executionMap: [], evidence: [], safeguardGaps: [], reviewPriority: "low", reviewPriorityExplanation: "No material consequence was established.",
    });
    expect(html).toContain('class="source-markdown"');
    expect(html).toContain('href="https://github.com/balancer/multisig-ops/pull/2882"');
    expect(html).toContain('href="https://forum.balancer.fi/t/bip-925-unwind-timeless-ve8020-bal-grant/7095"');
    expect(html).toContain("<h1>Source</h1>");
  });

  test("keeps raw HTML and unsafe URLs inert", () => {
    const html = renderSourceMarkdown("<script>window.pwned = true</script> [bad](javascript:alert(1)) [http](http://example.test) ![tracking](https://example.test/pixel.png) <img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("href=\"javascript:");
    expect(html).not.toContain("href=\"http:");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img ");
    expect(html).not.toContain("pixel.png");
  });
});
