const {
  assessmentLabel,
  buildProposalQuery,
  daysUntil,
  proposalMatchesSearch,
  safeHttpUrl,
  short,
} = require("../app.js");

describe("QuorumX frontend helpers", () => {
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

  test("presents assessment and compact identity labels", () => {
    expect(assessmentLabel("finalized")).toBe("Accepted");
    expect(assessmentLabel("in_progress")).toBe("In Progress");
    expect(assessmentLabel()).toBe("Not assessed");
    expect(short("0x1234567890abcdef")).toBe("0x1234…cdef");
  });
});
