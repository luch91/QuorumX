import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { AssessmentConsensusState } from "../domain/governance_risk_assessment";
import type { ProposalProvenance, ProposalSource } from "../domain/governance_proposal";

export interface TransactionEvidenceRecord {
  recordedAt: string;
  transactionId: string;
  proposalKey: string;
  state: AssessmentConsensusState;
  source: ProposalSource;
  provenance: ProposalProvenance;
  error?: string;
}

export interface TransactionEvidenceStore {
  append(record: TransactionEvidenceRecord): Promise<void>;
  find(transactionId: string): Promise<TransactionEvidenceRecord | undefined>;
}

export function projectTransactionEvidence(record: TransactionEvidenceRecord): TransactionEvidenceRecord {
  return JSON.parse(JSON.stringify(record)) as TransactionEvidenceRecord;
}

export class JsonlTransactionEvidenceStore implements TransactionEvidenceStore {
  constructor(private readonly path: string) {}
  async append(record: TransactionEvidenceRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(projectTransactionEvidence(record))}\n`, "utf8");
  }
  async find(transactionId: string): Promise<TransactionEvidenceRecord | undefined> {
    try {
      const lines = (await readFile(this.path, "utf8")).trim().split("\n").filter(Boolean);
      return lines.map((line) => JSON.parse(line) as TransactionEvidenceRecord).reverse()
        .find((record) => record.transactionId === transactionId);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
