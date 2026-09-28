import { createDefaultCliDependencies, runQuorumXCli } from "./quorumx_cli";

export { createDefaultCliDependencies, runQuorumXCli } from "./quorumx_cli";
export type { QuorumXCliDependencies } from "./quorumx_cli";

if (require.main === module) {
  void runQuorumXCli(process.argv.slice(2), createDefaultCliDependencies()).then((code) => {
    process.exitCode = code;
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 4;
  });
}
