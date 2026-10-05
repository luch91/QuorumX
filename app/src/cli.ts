import { createDefaultCliDependencies, runQuorumXCli } from "./quorumx_cli";
import { cliFailure } from "./cli/errors";

export { createDefaultCliDependencies, runQuorumXCli } from "./quorumx_cli";
export type { QuorumXCliDependencies } from "./quorumx_cli";

if (require.main === module) {
  const args = process.argv.slice(2);
  void runQuorumXCli(args, createDefaultCliDependencies()).then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    const failure = cliFailure(error);
    console.error(args.includes("--json") ? JSON.stringify({ error: failure.code, message: failure.message }) : `${failure.code}: ${failure.message}`);
    process.exitCode = failure.exitCode;
  });
}
