"""Direct Mode coverage for deterministic schema-3.4 evidence planning."""

import json
import os

import pytest


GENVM_SDK_VERSION = "v0.2.16"
MATERIAL = (
    "The DAO multisig can recover the USDC by atomically calling "
    "`claimFees(FeeDistributor, USDC, DAO, 0)` four times.\n\n"
    "There is a PR with the DAO Safe payload at "
    "https://github.com/balancer/multisig-ops/pull/2882"
)
SOURCE = {"kind": "snapshot", "space": "balancer.eth", "proposalId": "0x" + "a" * 64}


@pytest.fixture(autouse=True)
def windows_genlayer_test_stdin_cleanup(monkeypatch, request):
    if os.name != "nt":
        yield
        return
    vm = request.getfixturevalue("direct_vm")
    original_unlink = os.unlink
    deferred_paths = []

    def defer_open_temp_unlink(path, *args, **kwargs):
        try:
            return original_unlink(path, *args, **kwargs)
        except PermissionError:
            deferred_paths.append(path)

    monkeypatch.setattr(os, "unlink", defer_open_temp_unlink)
    yield
    original_stdin = getattr(vm, "_original_stdin_fd", None)
    if original_stdin is not None:
        os.dup2(original_stdin, 0)
        os.close(original_stdin)
        vm._original_stdin_fd = None
    for path in deferred_paths:
        original_unlink(path)


def decision():
    return {
        "schemaVersion": "3.4", "proposalObjective": "Recover USDC.",
        "actions": [{"id": "claim-fees", "operation": "token_claim", "actor": "DAO multisig",
                     "function": "claimFees", "arguments": ["FeeDistributor", "USDC", "DAO", "0"],
                     "asset": "USDC", "recipient": "DAO", "frequency": "4 calls", "conditions": [],
                     "dependencies": [], "sourceExcerpt": MATERIAL}],
        "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": [],
        "grounding": {"proposalObjective": "grounded", "actions": [
            {"id": "claim-fees", "state": "grounded", "retained": True, "fields": []}
        ]},
    }


def test_v34_evidence_plan_is_deterministic_in_genvm(direct_deploy):
    contract = direct_deploy("contracts/evidence_planner_v3_4.py", sdk_version=GENVM_SDK_VERSION)

    result = json.loads(contract.plan(json.dumps(decision()), MATERIAL, json.dumps(SOURCE), "retrospective"))

    assert contract.get_schema() == "3.4"
    assert [item["adapter"] for item in result["items"]] == ["ethereum_rpc_contract_state", "github_execution_pr"]
    assert result["items"][1]["isExecutionProof"] is False
