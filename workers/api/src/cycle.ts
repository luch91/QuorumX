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
import {
  getTransactionState, readAssessment, readDueDiligence, readDueDiligenceV3, submitAssessment, submitDueDiligence, submitDueDiligenceV3,
  type GenLayerSettings,
} from "./genlayer";
import { fetchRecentSnapshotProposals } from "./snapshot";
import { snapshotSourceForSpace } from "./sources";
import { contractCanonicalJson, sha256 } from "./canonical";

export interface CycleSettings {
  databaseUrl: string;
  snapshotSpaces: string[];
  snapshotLimit: number;
  enableWrites: boolean;
  assessmentVersion?: "1" | "2" | "3";
  assessmentSchemaVersion?: string;
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
      if (job.assessmentVersion === "2" && !job.contractAddress && !settings.genlayer.dueDiligenceContractAddress) continue;
      if (job.assessmentVersion === "3" && !job.contractAddress && !settings.genlayer.dueDiligenceV3ContractAddress) continue;
      try {
        const transaction = await getTransactionState(settings.genlayer, job.transactionId);
        if (transaction.state === "accepted") {
          const assessment = job.assessmentVersion === "3"
            ? await readDueDiligenceV3(settings.genlayer, job.proposalKey, job.expectedContractContentHash,
              job.contractAddress as `0x${string}` | undefined,
              job.assessmentSchemaVersion === "3.3" ? job.assessmentRunId : undefined)
            : job.assessmentVersion === "2"
              ? await readDueDiligence(settings.genlayer, job.proposalKey, job.expectedContractContentHash,
                job.contractAddress as `0x${string}` | undefined)
              : await readAssessment(settings.genlayer, job.proposalKey);
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
          if (job.assessmentSchemaVersion === "3.3" && (!("assessmentRunId" in assessment)
              || assessment.assessmentSchemaVersion !== job.assessmentSchemaVersion
              || assessment.assessmentRunId !== job.assessmentRunId)) {
            await markSubmittedTerminal(client, job, "undetermined", "assessment run ID does not match submitted job");
            result.transactionsRecovered += 1;
            continue;
          }
          const expectedSourceLocatorHash = job.source ? await sha256(contractCanonicalJson(job.source)) : undefined;
          if (expectedSourceLocatorHash && assessment.sourceLocatorHash !== expectedSourceLocatorHash) {
            await markSubmittedTerminal(client, job, "undetermined", "source locator hash does not match indexed proposal source");
            result.transactionsRecovered += 1;
            continue;
          }
          await finalizeAssessment(client, {
            jobId: job.jobId,
            revisionId: job.revisionId,
            transactionRowId: job.transactionRowId,
            assessment,
            indexedFrom: "submitted_transaction",
            assessmentRunId: job.assessmentRunId,
            assessmentSchemaVersion: job.assessmentSchemaVersion,
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
      const source = snapshotSourceForSpace(space);
      try {
        const proposals = await fetchRecentSnapshotProposals(space, settings.fetcher ?? fetch, settings.snapshotLimit);
        const ingested = await ingestSnapshotProposals(client, source, proposals, new Date(), settings.assessmentVersion ?? "1",
          settings.assessmentSchemaVersion ?? settings.assessmentVersion ?? "1");
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
    const activeVersion = settings.assessmentVersion ?? "1";
    const activeSchema = settings.assessmentSchemaVersion ?? activeVersion;
    const job = await claimAssessmentJob(client, settings.workerId ?? crypto.randomUUID(), activeVersion, activeSchema);
    if (!job) return;
    try {
      if (job.assessmentVersion === "2") {
        const transactionId = await submitDueDiligence(settings.genlayer, job.source, `qx:v2:${job.revisionHash}`);
        await recordSubmittedTransaction(client, job, transactionId, "studionet",
          settings.genlayer.dueDiligenceContracts?.["2"] ?? settings.genlayer.dueDiligenceContractAddress!);
        result.jobsProcessed += 1;
        return;
      }
      if (job.assessmentVersion === "3") {
        const transactionId = await submitDueDiligenceV3(settings.genlayer, job.source,
          job.assessmentRunId ?? `qx:v3.3:${job.revisionHash}`);
        await recordSubmittedTransaction(client, job, transactionId, "studionet",
          settings.genlayer.dueDiligenceContracts?.["3.3"] ?? settings.genlayer.dueDiligenceV3ContractAddress!);
        result.jobsProcessed += 1;
        return;
      }
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
