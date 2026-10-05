import {
  claimAssessmentJob,
  deferSubmittedPoll,
  finalizeAssessment,
  ingestSnapshotProposals,
  isSourcePollDue,
  sourcePollOffset,
  listSubmittedJobs,
  markJobRetry,
  markSubmittedTerminal,
  markSubmissionUncertain,
  quarantineSubmittedAssessment,
  prepareSubmissionIntent,
  recordSourceFailure,
  recordSubmittedTransaction,
  withDatabase,
} from "./database";
import { DueDiligenceBoundaryError } from "./due_diligence";
import type { CycleResult, StoredAssessment, StoredDueDiligenceAssessment } from "./domain";
import {
  findSubmittedTransaction, getTransactionState, readAssessment, readDueDiligence, submitAssessment, submitDueDiligence,
  type GenLayerSettings,
} from "./genlayer";
import { fetchRecentSnapshotProposals } from "./snapshot";
import { snapshotSourceForSpace } from "./sources";

export interface CycleSettings {
  databaseUrl: string;
  snapshotSpaces: string[];
  snapshotLimit: number;
  enableWrites: boolean;
  assessmentVersion?: "1" | "2";
  genlayer: GenLayerSettings;
  workerId?: string;
  fetcher?: typeof fetch;
  externalCallTimeoutMs?: number;
  cycleBudgetMs?: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function within<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function runIndexerCycle(settings: CycleSettings): Promise<CycleResult> {
  const startedAt = Date.now();
  const callTimeout = settings.externalCallTimeoutMs ?? 15_000;
  const cycleBudget = settings.cycleBudgetMs ?? 50_000;
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
      if (job.assessmentVersion === "2"
        && (settings.assessmentVersion !== "2" || !settings.genlayer.dueDiligenceContractAddress)) continue;
      try {
        const transaction = await within(getTransactionState(settings.genlayer, job.transactionId), callTimeout, "transaction_read");
        if (transaction.state === "accepted") {
          const assessment = await within<StoredAssessment | StoredDueDiligenceAssessment | undefined>(job.assessmentVersion === "2"
            ? readDueDiligence(settings.genlayer, job.proposalKey, job.expectedContractContentHash)
            : readAssessment(settings.genlayer, job.proposalKey), callTimeout, "assessment_read");
          if (!assessment) {
            await markSubmittedTerminal(client, job, "reverted", "finalized without stored assessment state");
            result.transactionsRecovered += 1;
            continue;
          }
          if (job.expectedContractContentHash && assessment.contentHash !== job.expectedContractContentHash) {
            await markSubmittedTerminal(client, job, "undetermined", "contract content hash does not match indexed revision");
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
        } else {
          await deferSubmittedPoll(client, job);
        }
      } catch (error) {
        if (job.assessmentVersion === "2" && error instanceof DueDiligenceBoundaryError) {
          await quarantineSubmittedAssessment(client, job, error.category);
          result.transactionsRecovered += 1;
          result.errors.push(`transaction ${job.transactionId}: ${error.category}`);
        } else {
          result.errors.push(`transaction ${job.transactionId}: ${errorMessage(error)}`);
        }
      }
    }

    for (const space of settings.snapshotSpaces) {
      if (Date.now() - startedAt >= cycleBudget) {
        result.errors.push("cycle_budget_exhausted");
        break;
      }
      const source = snapshotSourceForSpace(space);
      try {
        if (!await isSourcePollDue(client, source)) continue;
        const offset = await sourcePollOffset(client, source);
        const proposals = await fetchRecentSnapshotProposals(space, settings.fetcher ?? fetch, settings.snapshotLimit,
          Math.min(callTimeout, Math.max(1, cycleBudget - (Date.now() - startedAt))), offset);
        const nextOffset = proposals.length < settings.snapshotLimit ? 0 : offset + proposals.length;
        const ingested = await ingestSnapshotProposals(client, source, proposals, new Date(), settings.assessmentVersion ?? "1", nextOffset);
        result.sourcesPolled += 1;
        result.proposalsSeen += ingested.proposalsSeen;
        result.revisionsCreated += ingested.revisionsCreated;
        result.jobsCreated += ingested.jobsCreated;
      } catch (error) {
        const message = errorMessage(error);
        result.errors.push(`snapshot:${space}: ${message}`);
        await recordSourceFailure(client, source, message).catch((recordError) => {
          result.errors.push(`snapshot:${space}: could not record failure: ${errorMessage(recordError)}`);
        });
      }
    }

    if (!settings.enableWrites || !settings.genlayer.privateKey) return;
    if (Date.now() - startedAt >= cycleBudget) {
      result.errors.push("cycle_budget_exhausted");
      return;
    }
    const job = await claimAssessmentJob(client, settings.workerId ?? crypto.randomUUID(), settings.assessmentVersion ?? "1");
    if (!job) return;
    try {
      if (job.assessmentVersion === "2") {
        const idempotencyKey = `qx:v2:${job.expectedContractContentHash}`;
        const intent = await prepareSubmissionIntent(client, job, idempotencyKey);
        if (!intent.created) {
          const recovered = await within(findSubmittedTransaction(settings.genlayer, idempotencyKey,
            settings.genlayer.dueDiligenceContractAddress!), callTimeout, "submission_reconcile");
          if (recovered) {
            await recordSubmittedTransaction(client, job, recovered, "studionet", settings.genlayer.dueDiligenceContractAddress!);
            result.transactionsRecovered += 1;
          } else {
            await markSubmissionUncertain(client, job);
            result.errors.push(`job ${job.id}: submission_outcome_unknown`);
          }
          return;
        }
        const transactionId = await within(submitDueDiligence(settings.genlayer, job.source, idempotencyKey), callTimeout, "assessment_submit");
        await recordSubmittedTransaction(client, job, transactionId, "studionet", settings.genlayer.dueDiligenceContractAddress!);
        result.jobsProcessed += 1;
        return;
      }
      const existing = await within(readAssessment(settings.genlayer, job.proposalKey), callTimeout, "assessment_read");
      if (existing?.contentHash === job.expectedContractContentHash) {
        await finalizeAssessment(client, {
          jobId: job.id,
          revisionId: job.revisionId,
          assessment: existing,
          indexedFrom: "existing_contract_state",
        });
      } else {
        const idempotencyKey = `qx:${job.revisionHash}`;
        const intent = await prepareSubmissionIntent(client, job, idempotencyKey);
        if (!intent.created) {
          const recovered = await within(findSubmittedTransaction(settings.genlayer, idempotencyKey,
            settings.genlayer.contractAddress), callTimeout, "submission_reconcile");
          if (recovered) {
            await recordSubmittedTransaction(client, job, recovered, "studionet", settings.genlayer.contractAddress);
            result.transactionsRecovered += 1;
          } else {
            await markSubmissionUncertain(client, job);
            result.errors.push(`job ${job.id}: submission_outcome_unknown`);
          }
          return;
        }
        const transactionId = await within(submitAssessment(settings.genlayer, job.source, idempotencyKey), callTimeout, "assessment_submit");
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
