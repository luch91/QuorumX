import importlib.util
import json
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


def test_deterministic_candidate_validation_accepts_bip_933_without_an_llm_review():
    module = load_module()
    fixture = json.loads((pathlib.Path(__file__).parents[2] / "fixtures" / "decision_ir" / "bip_933.json").read_text())
    excerpt = "The DAO multisig can recover the USDC by atomically calling `claimFees(FeeDistributor, USDC, DAO, 0)` four times. This is necessary because the grant has accumulated more than 60 weeks of unclaimed USDC, while the FeeDistributor settles at most 20 weeks per call."
    record = module.normalize_grounded_decision_ir(candidate(
        "The DAO multisig can recover the USDC by atomically calling claimFees(FeeDistributor, USDC, DAO, 0) four times.", [
            action("claim-fees", "token_claim", excerpt, actor="DAO multisig", function="claimFees",
                   arguments=["FeeDistributor", "USDC", "DAO", "0"], asset="USDC", amount="10,286.807445 USDC",
                   recipient="DAO", frequency="four times", dependencies=["more than 60 weeks", "at most 20 weeks per call"]),
        ]), fixture["body"])
    assert module.deterministic_candidate_valid(record, fixture["body"]) is True


def test_deterministic_candidate_validation_rejects_malicious_relationships_and_omissions():
    module = load_module()
    first = "The DAO multisig will call `claimFees(FeeDistributor, USDC, DAO, 0)` four times."
    second = "The DAO multisig will execute `setFee(5)` once."
    material = first + " " + second
    valid = module.normalize_grounded_decision_ir(candidate("The DAO multisig will call claimFees(FeeDistributor, USDC, DAO, 0) four times.", [
        action("claim", "token_claim", first, actor="DAO multisig", function="claimFees",
               arguments=["FeeDistributor", "USDC", "DAO", "0"], asset="USDC", recipient="DAO", frequency="four times"),
        action("fee", "parameter_change", second, actor="DAO multisig", function="setFee", arguments=["5"], frequency="once"),
    ]), material)
    assert module.deterministic_candidate_valid(valid, material) is True

    wrong_recipient = json.loads(module.canonical(valid))
    wrong_recipient["actions"][0]["recipient"] = "Treasury"
    assert module.deterministic_candidate_valid(wrong_recipient, material) is False

    omitted = json.loads(module.canonical(valid))
    omitted["actions"] = omitted["actions"][:1]
    omitted["grounding"]["actions"] = omitted["grounding"]["actions"][:1]
    assert module.deterministic_candidate_valid(omitted, material) is False


def test_negated_or_heading_only_actions_remain_unresolved():
    module = load_module()
    negated = "The DAO will not execute a transfer of 100 USDC to Treasury."
    record = module.normalize_grounded_decision_ir(candidate(negated, [
        action("no-transfer", "treasury_transfer", negated, asset="USDC", amount="100", recipient="Treasury"),
    ]), negated)
    assert record["actions"] == []
    assert module.deterministic_candidate_valid(record, negated) is True


def test_deterministic_verifier_scopes_negation_and_rejects_wrong_function_arguments():
    module = load_module()
    rejected = "The DAO will not execute a transfer of 100 USDC to Treasury."
    requested = "The DAO multisig will call claimFees(FeeDistributor, USDC, DAO, 0) four times."
    material = rejected + " " + requested
    record = module.normalize_grounded_decision_ir(candidate(requested, [
        action("claim", "token_claim", requested, actor="DAO multisig", function="claimFees",
               arguments=["FeeDistributor", "USDC", "DAO", "0"], asset="USDC", recipient="DAO", frequency="four times"),
    ]), material)
    assert [item["id"] for item in record["actions"]] == ["claim"]
    assert module.deterministic_candidate_valid(record, material) is True

    malicious = json.loads(module.canonical(record))
    malicious["actions"][0]["arguments"] = ["FeeDistributor", "DAO", "USDC", "0"]
    assert module.deterministic_candidate_valid(malicious, material) is False


def test_deterministic_verifier_rejects_an_omitted_explicit_treasury_action():
    module = load_module()
    first = "The DAO will transfer 100 USDC to Treasury."
    second = "The DAO multisig will call setFee(5)."
    material = first + " " + second
    omitted_transfer = module.normalize_grounded_decision_ir(candidate(second, [
        action("fee", "parameter_change", second, actor="DAO multisig", function="setFee", arguments=["5"]),
    ]), material)
    assert module.deterministic_candidate_valid(omitted_transfer, material) is False
