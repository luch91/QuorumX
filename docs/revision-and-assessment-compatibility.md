# Revision and assessment compatibility

Proposal content revisions are immutable and deduplicated by proposal and content hash. Every ingest appends an observation. `proposals.current_observation_id` identifies the latest observation and `current_revision_id` identifies its content, including an A → B → A sequence where the third observation points back to the original A revision.

Accepted assessments are revision-bound records. A retry is idempotent only when every stored field, the assessment version, and transaction provenance are identical. A different accepted result for the same revision is rejected. Transactions are valid provenance only when their job belongs to the same revision. Operator-owned `quorumx.assessment_integrity_issues` reports inconsistent rows that predate these constraints; migrations do not rewrite or discard them.

Public v1 assessment fields remain unchanged. The legacy v1 contract keeps the proposal key as the latest-record lookup and stores new accepted records under a revision-specific key. New idempotency entries point to that immutable revision record, so retrying `Afterglow` revision A still returns A after revision B becomes current. Entries created by the original deployment contain only a proposal pointer and therefore retain their historic latest-record behavior; they cannot be reconstructed without external evidence.

V1 material over 24,000 characters is rejected before model assessment. It is never silently truncated. V2 uses the same reject-before-assessment policy.
