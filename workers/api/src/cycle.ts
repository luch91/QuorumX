import {
  claimAssessmentJob,
  finalizeAssessment,
  ingestSnapshotProposals,
  listSubmittedJobs,
  markJobRetry,
  markSubmittedTerminal,
  recordSourceFailure,
  recordSubmittedTransaction,
  withDatabase,
} from "./database";
import type { CycleResult } from "./domain";
import { getTransactionState, readAssessment, submitAssessment, type GenLayerSettings } from "./genlayer";
import { fetchRecentSnapshotProposals } from "./snapshot";

export interface CycleSettings {
  databaseUrl: string;
  snapshotSpaces: string[];
  snapshotLimit: number;
  enableWrites: boolean;
  genlayer: GenLayerSettings;
  workerId?: string;
  fetcher?: typeof fetch;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runIndexerCycle(settings: CycleSettings): Promise<CycleResult> {
  const result: CycleResult = {
    sourcesPolled: 0,
    proposalsSeen: 0,
    revisionsCreated: 0,
    jobsCreated: 0,
    transactionsRecovered: 0,
    jobsProcessed: 0,
    errors: [],
  };

  await withDatabase(settings.databaseUrl, async (client) => {
    const submitted = await listSubmittedJobs(client);
    for (const job of submitted) {
      try {
        const transaction = await getTransactionState(settings.genlayer, job.transactionId);
        if (transaction.state === "accepted") {
          const assessment = await readAssessment(settings.genlayer, job.proposalKey);
          if (!assessment) {
            await markSubmittedTerminal(client, job, "reverted", "finalized without stored assessment state");
            result.transactionsRecovered += 1;
            continue;
          }
          await finalizeAssessment(client, {
            jobId: job.jobId,
            revisionId: job.revisionId,
            transactionRowId: job.transactionRowId,
            assessment,
            indexedFrom: "submitted_transaction",
          });
          result.transactionsRecovered += 1;
        } else if (transaction.state === "undetermined" || transaction.state === "reverted") {
          await markSubmittedTerminal(client, job, transaction.state, transaction.error);
          result.transactionsRecovered += 1;
        }
      } catch (error) {
        result.errors.push(`transaction ${job.transactionId}: ${errorMessage(error)}`);
      }
    }

    for (const space of settings.snapshotSpaces) {
      try {
        const proposals = await fetchRecentSnapshotProposals(space, settings.fetcher ?? fetch, settings.snapshotLimit);
        const ingested = await ingestSnapshotProposals(client, space, proposals);
        result.sourcesPolled += 1;
        result.proposalsSeen += ingested.proposalsSeen;
        result.revisionsCreated += ingested.revisionsCreated;
        result.jobsCreated += ingested.jobsCreated;
      } catch (error) {
        const message = errorMessage(error);
        result.errors.push(`snapshot:${space}: ${message}`);
        await recordSourceFailure(client, space, message).catch((recordError) => {
          result.errors.push(`snapshot:${space}: could not record failure: ${errorMessage(recordError)}`);
        });
      }
    }

    if (!settings.enableWrites || !settings.genlayer.privateKey) return;
    const job = await claimAssessmentJob(client, settings.workerId ?? crypto.randomUUID());
    if (!job) return;
    try {
      const existing = await readAssessment(settings.genlayer, job.proposalKey);
      if (existing?.contentHash === job.expectedContractContentHash) {
        await finalizeAssessment(client, {
          jobId: job.id,
          revisionId: job.revisionId,
          assessment: existing,
          indexedFrom: "existing_contract_state",
        });
      } else {
        const transactionId = await submitAssessment(settings.genlayer, job.source, `qx:${job.revisionHash}`);
        await recordSubmittedTransaction(
          client,
          job,
          transactionId,
          "studionet",
          settings.genlayer.contractAddress,
        );
      }
      result.jobsProcessed += 1;
    } catch (error) {
      const message = errorMessage(error);
      await markJobRetry(client, job, message);
      result.errors.push(`job ${job.id}: ${message}`);
    }
  });

  return result;
}
