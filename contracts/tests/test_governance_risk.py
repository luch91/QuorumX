import importlib.util
import json
import pathlib
import sys
import types
import unittest
from urllib.parse import parse_qs, urlparse


def load_contract_module():
    fake = types.ModuleType("genlayer")
    identity = lambda fn: fn
    fake.gl = types.SimpleNamespace(
        Contract=object, public=types.SimpleNamespace(view=identity, write=identity)
    )
    fake.TreeMap = dict
    fake.u32 = int
    fake.allow_storage = lambda value: value
    fake.dataclass = __import__("dataclasses").dataclass
    sys.modules["genlayer"] = fake
    path = pathlib.Path(__file__).parents[1] / "governance_risk.py"
    spec = importlib.util.spec_from_file_location("governance_risk", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class GovernanceRiskRulesTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_contract_module()

    def assessment(self, **overrides):
        value = {
            "proposal_key": "snapshot:gen.eth:p-1",
            "content_hash": "a" * 64,
            "risk_level": "medium",
            "score": 51,
            "categories": ["execution", "governance"],
            "recommendation": "manual_review",
            "summary": "Material execution assumptions need review.",
        }
        value.update(overrides)
        return value

    def test_builds_canonical_snapshot_graphql_get_url(self):
        proposal_id = "0xabc"
        url = urlparse(self.module.snapshot_proposal_url(proposal_id))
        params = parse_qs(url.query)
        self.assertEqual((url.scheme, url.netloc, url.path), ("https", "hub.snapshot.org", "/graphql"))
        self.assertEqual(json.loads(params["variables"][0]), {"id": proposal_id})
        self.assertIn("proposal(id: $id)", params["query"][0])

    def test_accepts_sdk_decoded_assessment_output(self):
        value = {"risk_level": "high", "score": 80}
        self.assertIs(self.module.parse_assessment_output(value), value)

    def test_accepts_fenced_json_assessment_output(self):
        value = self.module.parse_assessment_output('```json\n{"risk_level":"high","score":80}\n```')
        self.assertEqual(value, {"risk_level": "high", "score": 80})

    def test_rejects_unknown_category_and_invalid_score(self):
        with self.assertRaises(ValueError):
            self.module.normalize_assessment(self.assessment(categories=["tokenomics"]))
        with self.assertRaises(ValueError):
            self.module.normalize_assessment(self.assessment(score=101))

    def test_source_validation_and_stable_key(self):
        source = {"kind": "snapshot", "space": "gen.eth", "proposalId": "p-1"}
        normalized = self.module.parse_source(json.dumps(source))
        self.assertEqual(self.module.proposal_key(normalized), "snapshot:gen.eth:p-1")
        with self.assertRaises(ValueError):
            self.module.parse_source(json.dumps({"kind": "public_url", "url": "http://example.com"}))
        with self.assertRaisesRegex(ValueError, "Snapshot"):
            self.module.parse_source(json.dumps({"kind": "public_url", "url": "https://example.com/proposal"}))
        with self.assertRaises(ValueError):
            self.module.parse_source("not-json")

    def test_idempotency_key_is_bounded(self):
        self.module.validate_idempotency_key("run-2026-09-28")
        with self.assertRaises(ValueError):
            self.module.validate_idempotency_key("x" * 129)

    def configure_contract_runtime(self, material):
        current = [material]
        prompt_calls = []
        self.module.gl.eq_principle = types.SimpleNamespace(
            strict_eq=lambda fn: current[0],
            prompt_non_comparative=lambda fn, **kwargs: prompt_calls.append(fn()) or {
                "risk_level": "low", "score": 10, "categories": ["governance"],
                "recommendation": "allow", "summary": "Accepted fixture",
            },
        )
        self.module.gl.message_raw = {"datetime": "2026-10-05T12:00:00Z"}
        self.module.gl.vm = types.SimpleNamespace(UserError=ValueError)
        return current, prompt_calls

    def test_old_idempotency_key_returns_its_immutable_afterglow_revision(self):
        source = json.dumps({"kind": "snapshot", "space": "velvet.eth", "proposalId": "afterglow"})
        current, _ = self.configure_contract_runtime("Afterglow revision A")
        contract = self.module.GovernanceRiskOracle()
        revision_a = contract.assess(source, "afterglow-a")
        current[0] = "Afterglow revision B"
        revision_b = contract.assess(source, "afterglow-b")

        self.assertNotEqual(json.loads(revision_a)["content_hash"], json.loads(revision_b)["content_hash"])
        self.assertEqual(contract.assess(source, "afterglow-a"), revision_a)
        self.assertEqual(contract.get_assessment("snapshot:velvet.eth:afterglow"), revision_b)

    def test_oversized_v1_material_is_rejected_before_assessment(self):
        source = json.dumps({"kind": "snapshot", "space": "velvet.eth", "proposalId": "whimsy"})
        _, prompt_calls = self.configure_contract_runtime("x" * 24001)
        contract = self.module.GovernanceRiskOracle()

        with self.assertRaisesRegex(ValueError, "exceeds governance-risk limit"):
            contract.assess(source, "whimsy-large")
        self.assertEqual(prompt_calls, [])
        self.assertEqual(contract.assessments, {})
        self.assertEqual(contract.idempotency, {})


if __name__ == "__main__":
    unittest.main()
