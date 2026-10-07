import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("v3.3 additive migration", () => {
  const sql = readFileSync(resolve(process.cwd(), "database/migrations/0008_due_diligence_v3_3.sql"), "utf8");

  it("preserves historical rows while adding immutable schema and run identity", () => {
    expect(sql).toContain("assessment_schema_version");
    expect(sql).toContain("assessment_run_id");
    expect(sql).toContain("assessment_jobs_initial_revision_schema_idx");
    expect(sql).toContain("drop constraint if exists due_diligence_assessments_v3_revision_id_key");
    expect(sql).not.toMatch(/delete\s+from\s+quorumx\.due_diligence_assessments_v3/i);
  });

  it("removes runtime mutation authority from accepted v3 assessments", () => {
    expect(sql).toMatch(/revoke update, delete on quorumx\.due_diligence_assessments_v3 from quorumx_runtime/i);
    expect(sql).toMatch(/grant select, insert on quorumx\.due_diligence_assessments_v3 to quorumx_runtime/i);
  });
});
