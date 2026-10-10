"""Direct Mode coverage for the bounded schema-3.4 Decision IR boundary."""

import json
import os

import pytest


GENVM_SDK_VERSION = "v0.2.16"
MATERIAL = (
    "The DAO multisig can recover the USDC by atomically calling "
    "`claimFees(FeeDistributor, USDC, DAO, 0)` four times."
)


@pytest.fixture(autouse=True)
def windows_genlayer_test_stdin_cleanup(monkeypatch, request):
    """Work around genlayer-test's unlink-before-close behavior on Windows."""
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


def candidate():
    return {
        "proposalObjective": "Recover the USDC.",
        "actions": [{
            "id": "claim-fees", "operation": "token_claim", "actor": "DAO multisig",
            "function": "claimFees", "arguments": ["FeeDistributor", "USDC", "DAO", "0"],
            "asset": "USDC", "recipient": "DAO", "frequency": "4 calls",
            "conditions": [], "dependencies": [], "sourceExcerpt": MATERIAL,
        }],
        "claims": [], "safeguards": [], "executionConsequences": [],
        "unknowns": [], "evidenceReferences": [],
    }


def test_v34_normalization_boundary_is_deterministic_in_genvm(direct_vm, direct_deploy):
    contract = direct_deploy(
        "contracts/decision_ir_v3_4.py",
        sdk_version=GENVM_SDK_VERSION,
    )

    result = json.loads(contract.normalize_candidate(MATERIAL, json.dumps(candidate())))

    assert contract.get_schema() == "3.4"
    assert result["schemaVersion"] == "3.4"
    assert result["actions"][0]["function"] == "claimFees"


def test_v34_semantic_extraction_requires_matching_validator_normalization(direct_vm, direct_deploy):
    contract = direct_deploy(
        "contracts/decision_ir_v3_4.py",
        sdk_version=GENVM_SDK_VERSION,
    )
    direct_vm.mock_llm(r".*Decision IR.*", json.dumps(candidate()))

    result = json.loads(contract.extract(MATERIAL))

    assert result["actions"][0]["operation"] == "token_claim"
    assert direct_vm.run_validator() is True


def test_v34_semantic_extraction_rejects_a_different_valid_validator_ir(direct_vm, direct_deploy):
    contract = direct_deploy(
        "contracts/decision_ir_v3_4.py",
        sdk_version=GENVM_SDK_VERSION,
    )
    direct_vm.mock_llm(r".*Decision IR.*", json.dumps(candidate()))
    contract.extract(MATERIAL)

    different = candidate()
    different["actions"][0]["operation"] = "contract_call"
    direct_vm.clear_mocks()
    direct_vm.mock_llm(r".*Decision IR.*", json.dumps(different))

    assert direct_vm.run_validator() is False


def test_v34_normalization_downgrades_ungrounded_candidate_field_in_genvm(direct_deploy):
    contract = direct_deploy(
        "contracts/decision_ir_v3_4.py",
        sdk_version=GENVM_SDK_VERSION,
    )
    ungrounded = candidate()
    ungrounded["actions"][0]["recipient"] = "Other DAO"

    result = json.loads(contract.normalize_candidate(MATERIAL, json.dumps(ungrounded)))

    assert result["actions"][0]["recipient"] is None
    assert result["grounding"]["actions"][0]["state"] == "partially_grounded"
