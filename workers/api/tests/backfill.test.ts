import { boundedBackfillOptions, parseBackfillCommand, roundRobinBackfill, summarizeBackfill } from "../src/backfill";

describe("bounded historical backfill", () => {
  it("enforces safe defaults and hard bounds", () => {
    expect(boundedBackfillOptions({})).toEqual({ perDaoLimit: 25, totalLimit: 100, windowDays: 90, dailySubmissionBudget: 4 });
    expect(() => boundedBackfillOptions({ perDaoLimit: 26 })).toThrow("per_dao_limit");
    expect(() => boundedBackfillOptions({ totalLimit: 101 })).toThrow("total_limit");
    expect(() => boundedBackfillOptions({ dailySubmissionBudget: 0 })).toThrow("daily_submission_budget");
  });

  it.each([
    [{ perDaoLimit: 0 }, "per_dao_limit"], [{ perDaoLimit: 1.5 }, "per_dao_limit"],
    [{ totalLimit: 0 }, "total_limit"], [{ windowDays: 0 }, "window_days"],
    [{ windowDays: 91 }, "window_days"], [{ dailySubmissionBudget: 26 }, "daily_submission_budget"],
  ])("rejects an invalid bound %j", (value, error) => {
    expect(() => boundedBackfillOptions(value)).toThrow(error);
  });

  it("parses commands without silently defaulting wrong-typed values", () => {
    expect(parseBackfillCommand({ action: "dry-run", totalLimit: 4 })).toEqual({
      action: "dry-run", options: { perDaoLimit: 25, totalLimit: 4, windowDays: 90, dailySubmissionBudget: 4 },
    });
    expect(parseBackfillCommand({ action: "status", runId: "12" })).toEqual({ action: "status", runId: "12" });
    expect(() => parseBackfillCommand(null)).toThrow("invalid_request_body");
    expect(() => parseBackfillCommand([])).toThrow("invalid_request_body");
    expect(() => parseBackfillCommand({ action: "dry-run", totalLimit: "4" })).toThrow("invalid_total_limit");
    expect(() => parseBackfillCommand({ action: "unknown" })).toThrow("invalid_action");
    expect(() => parseBackfillCommand({ action: "pause" })).toThrow("invalid_run_id");
  });

  it("reports every required state per DAO and remaining work", () => {
    const report = summarizeBackfill([
      { dao: "SafeDAO", state: "accepted" }, { dao: "SafeDAO", state: "queued" },
      { dao: "Arbitrum DAO", state: "failed" }, { dao: "ENS DAO", state: "skipped" },
      { dao: "Balancer", state: "eligible" },
    ]);
    expect(report.total).toMatchObject({ eligible: 1, queued: 1, accepted: 1, skipped: 1, failed: 1, remaining: 2 });
    expect(Object.keys(report.byDao)).toEqual(["SafeDAO", "Arbitrum DAO", "ENS DAO", "Balancer"]);
  });

  it("applies the total limit fairly across all four DAOs", () => {
    const rows = roundRobinBackfill(new Map([
      ["SafeDAO", ["s1", "s2"]], ["Arbitrum DAO", ["a1", "a2"]],
      ["ENS DAO", ["e1", "e2"]], ["Balancer", ["b1", "b2"]],
    ]), 4);
    expect(rows).toEqual([
      { dao: "SafeDAO", canonicalId: "s1" }, { dao: "Arbitrum DAO", canonicalId: "a1" },
      { dao: "ENS DAO", canonicalId: "e1" }, { dao: "Balancer", canonicalId: "b1" },
    ]);
  });
});
