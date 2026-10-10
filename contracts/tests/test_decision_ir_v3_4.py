import importlib.util
import json
from pathlib import Path
import sys
import types

import pytest


def load_module():
    fake = types.ModuleType("genlayer")
    identity = lambda fn: fn
    fake.gl = types.SimpleNamespace(Contract=object, public=types.SimpleNamespace(view=identity, write=identity))
    sys.modules["genlayer"] = fake
    path = Path(__file__).parents[1] / "decision_ir_v3_4.py"
    spec = importlib.util.spec_from_file_location("decision_ir_v3_4", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULE = load_module()
canonical_decision_ir = MODULE.canonical_decision_ir
normalize_decision_ir = MODULE.normalize_decision_ir


FIXTURE = json.loads((Path(__file__).parents[2] / "fixtures" / "decision_ir" / "bip_933.json").read_text(encoding="utf-8"))
EXCERPT = "The DAO multisig can recover the USDC by atomically calling `claimFees(FeeDistributor, USDC, DAO, 0)` four times. This is necessary because the grant has accumulated more than 60 weeks of unclaimed USDC, while the FeeDistributor settles at most 20 weeks per call."


def bip_response():
    return {"proposalObjective": "Recover unclaimed USDC FeeDistributor rewards.", "actions": [{
        "id": "claim-fees", "actor": "DAO multisig", "operation": "token_claim", "target": "Timeless VeBalGrant",
        "function": "claimFees", "arguments": ["FeeDistributor", "USDC", "DAO", "0"], "asset": "USDC",
        "amount": "approximately 10,286.807445", "recipient": "DAO", "frequency": "4 calls",
        "conditions": ["FeeDistributor settles at most 20 weeks per call"],
        "dependencies": ["the grant has accumulated more than 60 weeks of unclaimed USDC"], "sourceExcerpt": EXCERPT,
    }], "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": []}


def test_bip_933_normalizes_a_bounded_claim_fees_action():
    result = normalize_decision_ir(bip_response(), FIXTURE["body"])
    action = result["actions"][0]
    assert result["schemaVersion"] == "3.4"
    assert action["operation"] == "token_claim"
    assert action["function"] == "claimFees"
    assert action["asset"] == "USDC"
    assert action["recipient"] == "DAO"
    assert action["frequency"] == "4 calls"


def test_bip_933_generic_contract_call_is_representable_without_extra_inference():
    response = bip_response()
    response["actions"][0]["operation"] = "contract_call"
    result = normalize_decision_ir(response, FIXTURE["body"])
    action = result["actions"][0]
    assert action["function"] == "claimFees"
    assert action["arguments"] == ["0", "DAO", "FeeDistributor", "USDC"]


def test_safe_fixture_represents_two_grounded_funding_actions_deterministically():
    fixture = json.loads((Path(__file__).parents[2] / "fixtures" / "decision_ir" / "safe_sep56.json").read_text(encoding="utf-8"))
    material = fixture["bodyExcerpt"]
    raw = {"proposalObjective": "Fund Safenet Aegis.", "actions": [
        {"id": "sentinel-grants", "operation": "grant_or_funding", "actor": "SafeDAO", "target": "six genesis Sentinels", "asset": "SAFE", "amount": "~2,400,000 SAFE", "conditions": ["milestone-based grants"], "dependencies": [], "sourceExcerpt": material},
        {"id": "validator-rewards", "operation": "grant_or_funding", "actor": "SafeDAO", "target": "Safenet Aegis", "asset": "SAFE", "amount": "~5,000,000 SAFE", "conditions": [], "dependencies": ["validator staking rewards"], "sourceExcerpt": material},
    ], "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": []}
    first = normalize_decision_ir(raw, material)
    second = normalize_decision_ir({**raw, "actions": list(reversed(raw["actions"]))}, material)
    assert [action["id"] for action in first["actions"]] == ["sentinel-grants", "validator-rewards"]
    assert canonical_decision_ir(first) == canonical_decision_ir(second)


def test_parameter_change_requires_a_grounded_contract_call_shape():
    material = "The DAO multisig will call setFee(500) on the FeeController contract."
    result = normalize_decision_ir({"proposalObjective": "Set the fee.", "actions": [{
        "id": "set-fee", "operation": "parameter_change", "actor": "DAO multisig", "contract": "FeeController", "function": "setFee", "arguments": ["500"], "conditions": [], "dependencies": [], "sourceExcerpt": material,
    }], "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": []}, material)
    assert result["actions"][0]["operation"] == "parameter_change"
    assert result["actions"][0]["function"] == "setFee"


def test_ens_fixture_preserves_milestone_gated_funding_without_claiming_a_recipient():
    fixture = json.loads((Path(__file__).parents[2] / "fixtures" / "decision_ir" / "ens_marketplace_rfp.json").read_text(encoding="utf-8"))
    material = fixture["bodyExcerpt"]
    result = normalize_decision_ir({"proposalObjective": "Fund an award.", "actions": [{
        "id": "award", "operation": "grant_or_funding", "amount": "up to $500,000", "conditions": ["milestone-gated", "traction gates verifiable on-chain"], "dependencies": [], "sourceExcerpt": material,
    }], "claims": [], "safeguards": [], "executionConsequences": [{
        "id": "return", "statement": "The balance returns to the DAO treasury", "sourceExcerpt": material,
    }], "unknowns": [], "evidenceReferences": []}, material)
    assert result["actions"][0]["recipient"] is None
    assert result["executionConsequences"][0]["statement"] == "The balance returns to the DAO treasury"


def test_rejects_a_value_without_an_exact_reviewed_excerpt():
    response = bip_response()
    response["actions"][0]["recipient"] = "Unrelated wallet"
    with pytest.raises(ValueError, match="not grounded"):
        normalize_decision_ir(response, FIXTURE["body"])


def test_rejects_unsupported_claim_statement_even_with_a_valid_excerpt():
    response = bip_response()
    response["claims"] = [{"id": "claim", "statement": "The treasury is solvent", "verificationTarget": "USDC", "sourceExcerpt": EXCERPT}]
    with pytest.raises(ValueError, match="not grounded"):
        normalize_decision_ir(response, FIXTURE["body"])


def test_signaling_has_no_executable_action_and_unknowns_remain_unknown():
    fixture = json.loads((Path(__file__).parents[2] / "fixtures" / "decision_ir" / "arbitrum_good_entry.json").read_text(encoding="utf-8"))
    material = fixture["bodyExcerpt"]
    result = normalize_decision_ir({"proposalObjective": "Signal a governance decision.", "actions": [], "claims": [], "safeguards": [],
        "executionConsequences": [], "unknowns": [{"id": "authority", "subject": "on-chain actions", "state": "unknown", "sourceExcerpt": "This proposal will not require an on-chain vote because there are no on-chain actions to be taken."}], "evidenceReferences": []}, material)
    assert result["actions"] == []
    assert result["unknowns"][0]["state"] == "unknown"
