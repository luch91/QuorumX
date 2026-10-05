import importlib.util
import json
import pathlib
import sys
import types


fake = types.ModuleType("genlayer")
identity = lambda fn: fn
fake.gl = types.SimpleNamespace(Contract=object, public=types.SimpleNamespace(view=identity, write=identity))
fake.TreeMap = dict
sys.modules["genlayer"] = fake
contract_path = pathlib.Path(__file__).parents[1] / "contracts" / "governance_due_diligence.py"
spec = importlib.util.spec_from_file_location("governance_due_diligence", contract_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

case = sys.argv[1] if len(sys.argv) > 1 else "halcyon"
safeguards = ["Safeguard " + str(index) for index in range(1, 7)] if case == "eclipse" else ["3/5 Safe"]
material = "200k users and 5M ARB\n" + "\n".join(safeguards)
source = {"kind": "snapshot", "space": "velvet-solace.test", "proposalId": case}
report = {
    "overview": {"purpose": "Fund a program", "requestedActions": ["Transfer 5M ARB"],
                 "assetsAffected": ["5M ARB"], "permissionsChanged": [], "controlChanges": []},
    "evidence": [{"id": "e1", "type": "proposal", "locator": "ignored", "description": "Proposal body"}],
    "materialClaims": [{"id": "c1", "claim": "The program has 200k users", "sourceExcerpt": "200k users",
                        "claimScope": "external_factual", "status": "unverified",
                        "explanation": "No independent source reviewed", "evidence": ["e1"], "confidence": "low"}],
    "findings": [{"id": "f1", "type": "treasury_exposure", "title": "Treasury transfer",
                  "observation": "5M ARB would move", "sourceExcerpt": "5M ARB",
                  "whyItMatters": "DAO control changes", "severity": "high", "confidence": "medium",
                  "evidence": ["e1"], "existingSafeguards": safeguards,
                  "missingSafeguards": ["Clawback not identified"], "reversible": False}],
    "executionMap": [{"id": "s1", "action": "Transfer 5M ARB", "reversible": False, "evidence": ["e1"]}],
    "unresolvedQuestions": [{"id": "q1", "question": "Who verifies milestones?",
                             "whyItMatters": "Disbursement depends on verification", "relatedFindingIds": ["f1"]}],
    "reviewPriorityExplanation": "High priority due to the treasury transfer and absent recovery mechanism.",
}
record = module.normalize_report(report, material, source)
record.update({
    "proposalKey": "snapshot:velvet-solace.test:" + case,
    "contentHash": module.sha256_text(material),
    "sourceLocatorHash": module.sha256_text(module.canonical_json(source)),
    "assessedAt": "2026-10-05T12:00:00Z",
    "provenance": "fixture",
    "consensus": {"state": "accepted", "method": "source_grounded_material_facts_v2"},
})
print(module.canonical_json(record))
