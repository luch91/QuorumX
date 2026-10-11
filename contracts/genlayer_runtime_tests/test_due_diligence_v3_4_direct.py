"""Direct Mode smoke coverage for the schema-3.4 assessment contract."""

import json
import os
from pathlib import Path

import pytest


GENVM_SDK_VERSION = "v0.2.16"
BIP_SOURCE = {
    "kind": "snapshot", "space": "balancer.eth",
    "proposalId": "0x5a66f49d3aa02d9474e13acd1e6ac81d4a93398a8df0ec6b3adbe5170a74d3d8",
}


@pytest.fixture(autouse=True)
def windows_genlayer_test_stdin_cleanup(monkeypatch, request):
    """Keep Direct Mode reliable on Windows (gltest unlinks stdin too early)."""
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


def test_schema_34_contract_deploys_with_the_decision_modules(direct_deploy, direct_owner, direct_alice):
    operator = "0x" + bytes(direct_alice).hex()
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_4.py",
        operator,
        json.dumps(["balancer.eth", "safe.eth", "arbitrumfoundation.eth", "ens.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    schema = json.loads(contract.get_contract_schema())
    assert schema == {
        "assessmentVersion": "3",
        "assessmentSchemaVersion": "3.4",
        "consensusMethod": "candidate_validated_structured_ir_v3_4",
    }


def test_bip_933_assessment_contains_a_grounded_decision_ir(direct_vm, direct_deploy, direct_owner, direct_alice):
    fixture = json.loads((Path(__file__).parents[2] / "fixtures" / "decision_ir" / "bip_933.json").read_text(encoding="utf-8"))
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_4.py", operator, json.dumps(["balancer.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    direct_vm.mock_web(r"^https://hub\.snapshot\.org/graphql\?", {
        "method": "GET", "status": 200,
        "body": json.dumps({"data": {"proposal": {
            "id": BIP_SOURCE["proposalId"], "title": fixture["title"], "body": fixture["body"],
            "choices": fixture["choices"], "state": "closed", "end": 1791309600,
            "space": {"id": "balancer.eth"},
        }}}),
    })
    excerpt = "The DAO multisig can recover the USDC by atomically calling `claimFees(FeeDistributor, USDC, DAO, 0)` four times. This is necessary because the grant has accumulated more than 60 weeks of unclaimed USDC, while the FeeDistributor settles at most 20 weeks per call."
    direct_vm.mock_llm(r".*Return JSON only with proposalObjective.*", json.dumps({
        "proposalObjective": "The DAO multisig can recover the USDC by atomically calling claimFees(FeeDistributor, USDC, DAO, 0) four times.",
        "actions": [{"id": "claim-fees", "operation": "token_claim", "actor": "DAO multisig",
          "function": "claimFees", "arguments": ["FeeDistributor", "USDC", "DAO", "0"],
          "asset": "USDC", "amount": "10,286.807445 USDC", "recipient": "DAO", "frequency": "four times",
          "conditions": [], "dependencies": ["more than 60 weeks", "at most 20 weeks per call"], "sourceExcerpt": excerpt}],
        "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": [],
    }))
    direct_vm.sender = direct_alice
    record = json.loads(contract.assess(json.dumps(BIP_SOURCE), "direct-v34-bip-933"))

    action = record["decisionIR"]["actions"][0]
    assert record["assessmentSchemaVersion"] == "3.4"
    assert action["actor"] == "DAO multisig"
    assert action["function"] == "claimFees"
    assert action["asset"] == "USDC"
    assert action["amount"] == "10,286.807445 USDC"
    assert action["recipient"] == "DAO"
    assert action["frequency"] == "four times"
    assert action["dependencies"] == ["at most 20 weeks per call", "more than 60 weeks"]
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*Review the proposed Decision IR.*", json.dumps({"acceptable": True}))
    assert direct_vm.run_validator() is True
    # A validator can reject the same syntactically grounded candidate when
    # its independent semantic review finds a material error or omission.
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*Review the proposed Decision IR.*", json.dumps({"acceptable": False}))
    assert direct_vm.run_validator() is False
