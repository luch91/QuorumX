import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("schema-3.4 assessment-job migration", () => {
  it("extends only the accepted schema-version constraint", () => {
    const sql = readFileSync(resolve(process.cwd(), "database/migrations/0014_schema_3_4_assessment_jobs.sql"), "utf8");
    expect(sql).toContain("assessment_jobs_assessment_schema_version_check");
    expect(sql).toContain("'3.4'");
    expect(sql).toContain("not valid");
    expect(sql).toContain("validate constraint");
    expect(sql).not.toContain("update quorumx.");
    expect(sql).not.toContain("delete from");
  });
});
