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
    path = Path(__file__).parents[1] / "evidence_planner_v3_4.py"
    spec = importlib.util.spec_from_file_location("evidence_planner_v3_4", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


MODULE = load_module()
plan_evidence = MODULE.plan_evidence
parse_github_execution_reference = MODULE.parse_github_execution_reference
normalize_github_execution_evidence = MODULE.normalize_github_execution_evidence
normalize_github_execution_response = MODULE.normalize_github_execution_response

FIXTURE = json.loads((Path(__file__).parents[2] / "fixtures" / "decision_ir" / "bip_933.json").read_text(encoding="utf-8"))
EXCERPT = "The DAO multisig can recover the USDC by atomically calling `claimFees(FeeDistributor, USDC, DAO, 0)` four times. This is necessary because the grant has accumulated more than 60 weeks of unclaimed USDC, while the FeeDistributor settles at most 20 weeks per call."


def grounded_claim_action():
    return {
        "schemaVersion": "3.4",
        "proposalObjective": "Recover unclaimed USDC FeeDistributor rewards.",
        "actions": [{
            "id": "claim-fees", "operation": "token_claim", "actor": "DAO multisig",
            "function": "claimFees", "arguments": ["FeeDistributor", "USDC", "DAO", "0"],
            "asset": "USDC", "amount": "approximately 10,286.807445", "recipient": "DAO",
            "frequency": "4 calls", "conditions": [],
            "dependencies": ["the grant has accumulated more than 60 weeks of unclaimed USDC"],
            "sourceExcerpt": EXCERPT,
        }],
        "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [],
        "evidenceReferences": [],
        "grounding": {"proposalObjective": "grounded", "actions": [{
            "id": "claim-fees", "state": "grounded", "retained": True, "fields": []
        }]},
    }


def source():
    return {"kind": "snapshot", "space": "balancer.eth", "proposalId": FIXTURE["proposalId"]}


def test_bip_933_plans_only_bounded_contract_and_allowlisted_github_evidence():
    result = plan_evidence(grounded_claim_action(), FIXTURE["body"], source(), "retrospective")

    assert result["schemaVersion"] == "3.4"
    assert [item["adapter"] for item in result["items"]] == ["ethereum_rpc_contract_state", "github_execution_pr"]
    github = result["items"][1]
    assert github["locator"] == "https://github.com/balancer/multisig-ops/pull/2882"
    assert github["authority"] == "contextual"
    assert github["verificationScope"] == "validator_retrieved_external_source"
    assert github["isExecutionProof"] is False


def test_planner_requires_grounded_retained_actions_and_never_uses_ungrounded_fields():
    decision = grounded_claim_action()
    decision["grounding"]["actions"][0]["retained"] = False
    decision["actions"][0]["contract"] = "InventedContract"

    with pytest.raises(ValueError, match="not retained"):
        plan_evidence(decision, FIXTURE["body"], source(), "live")


def test_safe_and_transaction_actions_plan_existing_bounded_adapters():
    safe = "0x1111111111111111111111111111111111111111"
    tx_hash = "0x" + "a" * 64
    material = "The DAO Safe at %s will change its threshold. Execution transaction: %s." % (safe, tx_hash)
    decision = {
        "schemaVersion": "3.4", "proposalObjective": "Change Safe threshold.",
        "actions": [
            {"id": "safe", "operation": "control_change", "target": safe, "sourceExcerpt": material},
            {"id": "tx", "operation": "contract_call", "target": tx_hash, "sourceExcerpt": material},
        ], "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": [],
        "grounding": {"proposalObjective": "grounded", "actions": [
            {"id": "safe", "state": "grounded", "retained": True, "fields": []},
            {"id": "tx", "state": "grounded", "retained": True, "fields": []},
        ]},
    }

    result = plan_evidence(decision, material, source(), "live")
    assert [item["adapter"] for item in result["items"]] == ["blockscout_transaction", "safe_state"]
    assert result["items"][0]["temporalScope"] == "inherently_historical"
    assert result["items"][1]["temporalScope"] == "current_state_observed"


def test_retrospective_safe_plan_requests_history_without_claiming_a_historical_anchor():
    safe = "0x1111111111111111111111111111111111111111"
    material = "The Safe at %s will change its threshold." % safe
    decision = {"schemaVersion": "3.4", "proposalObjective": "Change Safe threshold.",
                "actions": [{"id": "safe", "operation": "control_change", "target": safe, "sourceExcerpt": material}],
                "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": [],
                "grounding": {"proposalObjective": "grounded", "actions": [{"id": "safe", "state": "grounded", "retained": True, "fields": []}]}}
    item = plan_evidence(decision, material, source(), "retrospective")["items"][0]
    assert item["temporalScope"] == "current_state_observed"
    assert item["historicalLookupRequired"] is True
    assert item["fallbackTemporalScope"] == "current_state_observed"


def test_same_space_snapshot_references_plan_bounded_governance_history():
    previous = "0x" + "b" * 64
    material = "Recover funds. Related proposal: https://snapshot.box/#/s:balancer.eth/proposal/%s" % previous
    decision = grounded_claim_action()
    decision["actions"][0]["sourceExcerpt"] = material
    decision["actions"][0].pop("actor")
    decision["actions"][0].pop("function")
    decision["actions"][0].pop("asset")
    decision["actions"][0].pop("amount")
    decision["actions"][0].pop("recipient")
    decision["actions"][0].pop("frequency")
    decision["actions"][0]["arguments"] = []
    decision["actions"][0]["dependencies"] = []
    result = plan_evidence(decision, material, source(), "live")

    history = next(item for item in result["items"] if item["adapter"] == "snapshot_governance_history")
    assert history["locator"] == previous
    assert history["authority"] == "primary"


def test_grounded_transaction_claim_uses_blockscout_without_becoming_an_action():
    tx_hash = "0x" + "c" * 64
    material = "The previous execution transaction is %s." % tx_hash
    decision = {"schemaVersion": "3.4", "proposalObjective": "Review a transaction.", "actions": [],
                "claims": [{"id": "prior-execution", "statement": "The previous execution transaction is %s." % tx_hash,
                            "verificationTarget": tx_hash, "sourceExcerpt": material}],
                "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": [],
                "grounding": {"proposalObjective": "grounded", "actions": []}}
    result = plan_evidence(decision, material, source(), "retrospective")

    item = result["items"][0]
    assert item["adapter"] == "blockscout_transaction"
    assert item["actionIds"] == []
    assert item["claimIds"] == ["prior-execution"]


def test_shared_adapter_plan_retains_all_related_action_ids():
    address = "0x1111111111111111111111111111111111111111"
    material = "The DAO will call the contract at %s twice." % address
    actions = [{"id": name, "operation": "contract_call", "contract": address, "sourceExcerpt": material}
               for name in ("first", "second")]
    decision = {"schemaVersion": "3.4", "proposalObjective": "Call a contract.", "actions": actions,
                "claims": [], "safeguards": [], "executionConsequences": [], "unknowns": [], "evidenceReferences": [],
                "grounding": {"proposalObjective": "grounded", "actions": [
                    {"id": name, "state": "grounded", "retained": True, "fields": []} for name in ("first", "second")
                ]}}
    item = plan_evidence(decision, material, source(), "live")["items"][0]
    assert item["actionIds"] == ["first", "second"]


@pytest.mark.parametrize("url", [
    "https://github.com/evil-org/multisig-ops/pull/2882",
    "https://github.com/balancer/other/pull/2882",
    "http://github.com/balancer/multisig-ops/pull/2882",
    "https://github.com/balancer/multisig-ops/issues/2882",
    "https://github.com/balancer/multisig-ops/pull/2882?redirect=https://127.0.0.1/",
])
def test_github_execution_references_are_strictly_allowlisted(url):
    assert parse_github_execution_reference(url) is None


def test_github_evidence_is_bounded_normalized_and_anchored_but_not_execution_proof():
    reference = parse_github_execution_reference("https://github.com/balancer/multisig-ops/pull/2882")
    response = {
        "number": 2882, "state": "closed", "html_url": reference["locator"],
        "head": {"sha": "a" * 40}, "base": {"repo": {"full_name": "balancer/multisig-ops"}},
        "title": "Claim Timeless fee rewards", "body": "payload and simulations",
    }
    evidence = normalize_github_execution_evidence(reference, response, "2026-10-10T12:00:00Z")

    assert evidence["source"] == "github"
    assert evidence["authority"] == "contextual"
    assert evidence["temporalScope"] == "unknown"
    assert evidence["commitAnchor"] == "a" * 40
    assert len(evidence["contentHash"]) == 64
    assert evidence["retrievedAt"] == "2026-10-10T12:00:00Z"
    assert evidence["isExecutionProof"] is False


def test_github_evidence_rejects_wrong_identity_and_oversized_content():
    reference = parse_github_execution_reference("https://github.com/balancer/multisig-ops/pull/2882")
    bad = {"number": 2882, "state": "closed", "html_url": "https://github.com/balancer/multisig-ops/pull/1", "head": {"sha": "a" * 40}, "base": {"repo": {"full_name": "balancer/multisig-ops"}}, "title": "x", "body": "x"}
    with pytest.raises(ValueError, match="identity"):
        normalize_github_execution_evidence(reference, bad, "2026-10-10T12:00:00Z")
    bad["html_url"] = reference["locator"]
    bad["body"] = "x" * 32_001
    with pytest.raises(ValueError, match="body"):
        normalize_github_execution_evidence(reference, bad, "2026-10-10T12:00:00Z")


def test_github_http_response_is_content_typed_and_byte_bounded_before_normalization():
    reference = parse_github_execution_reference("https://github.com/balancer/multisig-ops/pull/2882")
    payload = {"number": 2882, "state": "closed", "html_url": reference["locator"], "head": {"sha": "a" * 40}, "base": {"repo": {"full_name": "balancer/multisig-ops"}}, "title": "x", "body": "x"}
    response = types.SimpleNamespace(status=200, headers={"content-type": "application/vnd.github+json"}, body=json.dumps(payload))
    assert normalize_github_execution_response(reference, response, "2026-10-10T12:00:00Z")["source"] == "github"
    response.headers = {"content-type": "text/html"}
    with pytest.raises(ValueError, match="content type"):
        normalize_github_execution_response(reference, response, "2026-10-10T12:00:00Z")
    response.headers = {"content-type": "application/json"}
    response.body = "x" * 64_001
    with pytest.raises(ValueError, match="exceeds limit"):
        normalize_github_execution_response(reference, response, "2026-10-10T12:00:00Z")
