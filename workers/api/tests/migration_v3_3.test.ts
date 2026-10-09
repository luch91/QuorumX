import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("format-3 additive migration", () => {
  const tableSql = readFileSync(resolve(process.cwd(), "database/migrations/0011_due_diligence_v3.sql"), "utf8");
  const sql = readFileSync(resolve(process.cwd(), "database/migrations/0012_due_diligence_v3_schema.sql"), "utf8");

  it("extends main's immutable assessment integrity and least-privilege rules to format 3", () => {
    expect(tableSql).toMatch(/create trigger due_diligence_v3_transaction_revision/i);
    expect(tableSql).toMatch(/create trigger due_diligence_v3_immutable/i);
    expect(tableSql).toMatch(/select '3'.+transaction_job_revision_mismatch/is);
    expect(tableSql).toMatch(/grant select, insert on quorumx\.due_diligence_assessments_v3/i);
    expect(tableSql).not.toMatch(/grant select, insert, update on quorumx\.due_diligence_assessments_v3/i);
  });

  it("preserves historical rows while adding immutable schema and run identity", () => {
    expect(sql).toContain("assessment_schema_version");
    expect(sql).toContain("assessment_run_id");
    expect(sql).toContain("assessment_jobs_initial_revision_schema_idx");
    expect(sql).toContain("default_assessment_job_schema");
    expect(sql).toContain("new.assessment_schema_version := case new.assessment_version");
    expect(sql).toContain("'legacy-job-' || new.id::text");
    expect(sql).toContain("drop constraint if exists due_diligence_assessments_v3_revision_id_key");
    expect(sql).not.toMatch(/delete\s+from\s+quorumx\.due_diligence_assessments_v3/i);
  });

  it("removes runtime mutation authority from accepted v3 assessments", () => {
    expect(sql).toMatch(/revoke update, delete on quorumx\.due_diligence_assessments_v3 from quorumx_runtime/i);
    expect(sql).toMatch(/grant select, insert on quorumx\.due_diligence_assessments_v3 to quorumx_runtime/i);
  });
});
