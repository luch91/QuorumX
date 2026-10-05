import { ProposalSourceError } from "../ingest/proposal_source";

export interface CliFailure {
  code: string;
  exitCode: number;
  message: string;
}

export function cliFailure(error: unknown): CliFailure {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ProposalSourceError) {
    if (error.code === "unavailable") return { code: "dependency_unavailable", exitCode: 5, message };
    return { code: error.code === "not_found" ? "proposal_not_found" : "invalid_proposal_reference", exitCode: 4, message };
  }
  if (message.includes("QUORUMX_GENLAYER_PRIVATE_KEY is required")) {
    return { code: "write_authorization_required", exitCode: 6, message };
  }
  if (message.includes("QUORUMX_GENLAYER_PRIVATE_KEY must be")) {
    return { code: "write_authorization_invalid", exitCode: 6, message };
  }
  if (/^QUORUMX_[A-Z_]+ (?:must|is invalid|requires)/.test(message)) {
    return { code: "invalid_configuration", exitCode: 4, message };
  }
  return { code: "internal_error", exitCode: 1, message };
}
