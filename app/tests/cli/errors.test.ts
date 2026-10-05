import { ProposalSourceError } from "../../src/ingest/proposal_source";
import { cliFailure } from "../../src/cli/errors";

describe("CLI failure contract", () => {
  it.each([
    [new ProposalSourceError("offline", "unavailable"), { code: "dependency_unavailable", exitCode: 5 }],
    [new ProposalSourceError("missing", "not_found"), { code: "proposal_not_found", exitCode: 4 }],
    [new Error("QUORUMX_GENLAYER_PRIVATE_KEY is required for assessment submission"), { code: "write_authorization_required", exitCode: 6 }],
    [new Error("QUORUMX_GENLAYER_PRIVATE_KEY must be a 32-byte hex key."), { code: "write_authorization_invalid", exitCode: 6 }],
    [new Error("unexpected"), { code: "internal_error", exitCode: 1 }],
  ])("classifies %s", (error, expected) => {
    expect(cliFailure(error)).toEqual({ ...expected, message: error.message });
  });
});
