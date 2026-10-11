import importlib.util
import pathlib
import sys
import types


def load_module():
    identity = lambda fn: fn
    fake = types.ModuleType("genlayer")
    fake.gl = types.SimpleNamespace(
        Contract=object,
        public=types.SimpleNamespace(view=identity, write=identity),
        vm=types.SimpleNamespace(UserError=ValueError, Return=object),
    )
    fake.TreeMap = dict
    sys.modules["genlayer"] = fake
    path = pathlib.Path(__file__).parents[1] / "governance_due_diligence_v3_4.py"
    spec = importlib.util.spec_from_file_location("governance_due_diligence_v3_4", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def candidate(objective, actions):
    return {"proposalObjective": objective, "actions": actions, "claims": [], "safeguards": [],
            "executionConsequences": [], "unknowns": [], "evidenceReferences": []}


def action(identifier, operation, excerpt, **fields):
    return {"id": identifier, "operation": operation, "sourceExcerpt": excerpt,
            "arguments": [], "conditions": [], "dependencies": [], **fields}


def test_signaling_ir_retains_no_executable_action():
    module = load_module()
    material = '{"body":"Signal support for the stated governance direction."}'
    record = module.normalize_grounded_decision_ir(
        candidate("Signal support for the stated governance direction.", []), material)
    assert record["actions"] == []
    assert record["grounding"]["proposalObjective"] == "grounded"


def test_multiple_grounded_actions_are_preserved_in_deterministic_id_order():
    module = load_module()
    first = "Call setFee(5) on the FeeController."
    second = "Transfer 100 USDC to the Grants Safe."
    material = '{"body":"' + first + ' ' + second + '"}'
    record = module.normalize_grounded_decision_ir(candidate(first, [
        action("transfer", "treasury_transfer", second, asset="USDC", amount="100", recipient="Grants Safe"),
        action("fee", "parameter_change", first, function="setFee", arguments=["5"]),
    ]), material)
    assert [item["id"] for item in record["actions"]] == ["fee", "transfer"]
    assert record["actions"][1]["recipient"] == "Grants Safe"


def test_unsupported_action_values_are_downgraded_not_recorded_as_facts():
    module = load_module()
    excerpt = "The DAO may call claimFees for USDC."
    material = '{"body":"' + excerpt + '"}'
    record = module.normalize_grounded_decision_ir(candidate(excerpt, [
        action("claim", "token_claim", excerpt, function="claimFees", asset="USDC", recipient="Invented recipient"),
    ]), material)
    action_record = record["actions"][0]
    assert "recipient" not in action_record
    assert record["grounding"]["actions"][0]["state"] == "partially_grounded"
