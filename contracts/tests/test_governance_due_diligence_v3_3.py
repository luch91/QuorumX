import importlib.util
import json
import pathlib
import sys
import types
import unittest


class Return:
    def __init__(self, calldata):
        self.calldata = calldata


class UserError(Exception):
    pass


def load_module():
    identity = lambda fn: fn
    fake = types.ModuleType("genlayer")
    fake.gl = types.SimpleNamespace(
        Contract=object,
        public=types.SimpleNamespace(view=identity, write=identity),
        vm=types.SimpleNamespace(UserError=UserError, Return=Return),
        message=types.SimpleNamespace(sender_address="owner"),
        message_raw={"datetime": "2026-10-06T00:00:00Z"},
    )
    fake.TreeMap = dict
    fake.Address = str
    sys.modules["genlayer"] = fake
    path = pathlib.Path(__file__).parents[1] / "governance_due_diligence_v3_3.py"
    spec = importlib.util.spec_from_file_location("governance_due_diligence_v3_3", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def table_material(module, row_count):
    rows = []
    for index in range(row_count):
        tx_hash = "0x" + format(index + 1, "064x")
        rows.append(f"| Transfer {index + 1} | {index + 1}.000000 | https://etherscan.io/tx/{tx_hash} |")
    return module.canonical({
        "body": "| Label | Amount (ETH) | Return Tx |\n| --- | --- | --- |\n"
                + "\n".join(rows)
                + f"\n| **Total** | {sum(range(1, row_count + 1))}.000000 | |",
    })


def returned_funds_for(table, safe_address):
    transactions = []
    total_wei = 0
    for index, row in enumerate(table["rows"]):
        value_wei = str(int(row["amountEth"].split(".")[0]) * 10**18)
        total_wei += int(value_wei)
        transactions.append({
            "transactionHash": row["transactionHash"],
            "status": "success",
            "blockNumber": index + 1,
            "blockHash": "0x" + format(index + 1, "064x"),
            "amountEth": row["amountEth"],
            "valueWei": value_wei,
            "from": "0x" + "9" * 40,
            "to": safe_address,
            "transferType": "transaction_value",
            "internalTransactionIndex": None,
            "chainId": 1,
        })
    return {
        "safeAddress": safe_address,
        "chainId": 1,
        "reportedTotalEth": table["totalEth"],
        "transactions": transactions,
        "exactTotalWei": str(total_wei),
    }


class DueDiligenceV33Test(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = load_module()

    def test_generic_distribution_does_not_invent_bip_930_facts(self):
        fixture_path = pathlib.Path(__file__).parents[2] / "fixtures" / "due_diligence_v3_3" / "generic_distribution.json"
        fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
        material = self.m.canonical(fixture)

        facts = self.m.derive_record_facts(material, None)
        report = self.m.build_report(
            facts,
            material,
            {"kind": "snapshot", "space": fixture["space"], "proposalId": fixture["id"]},
            "run-generic-1",
        )

        rendered = self.m.canonical(report).lower()
        self.assertEqual(report["assessmentSchemaVersion"], "3.3")
        self.assertEqual(report["assessmentRunId"], "run-generic-1")
        self.assertEqual(report["materialActions"][0]["id"], "a1")
        self.assertEqual(report["findings"][0]["relatedActionIds"], ["a1"])
        for unsupported in (
            "bip-930",
            "recovered-fund",
            "pre-exploit block 25872248",
            "per-pool allocations",
            "holder lists",
            "verification scripts",
            "claim contract",
        ):
            self.assertNotIn(unsupported, rendered)

    def test_generic_execution_steps_do_not_receive_claim_framework_templates(self):
        material = self.m.canonical({
            "id": "events-1", "space": "safe.eth", "title": "Community events",
            "body": "If this proposal passes, the following actions will be executed:\n"
                    "1. Publish the community event dates.\n"
                    "2. Deploy the event registration website.\n"
                    "3. Monitor attendance.",
            "choices": ["For", "Against"], "state": "active",
        })
        facts = self.m.derive_record_facts(material, None)
        report = self.m.build_report(
            facts, material,
            {"kind": "snapshot", "space": "safe.eth", "proposalId": "events-1"},
            "run-events-1",
        )
        rendered = self.m.canonical(report).lower()
        for unsupported in ("allocation inputs", "verification scripts", "claim framework", "claim window", "contract-account"):
            self.assertNotIn(unsupported, rendered)
        self.assertTrue(any("community event dates" in step["impact"].lower() for step in report["executionMap"]))
        self.assertFalse(any("what concrete action" in item["question"].lower()
                             for item in report["unresolvedQuestions"]))

    def test_governance_rule_change_does_not_become_safe_signer_change(self):
        material = self.m.canonical({
            "id": "quorum-1", "space": "safe.eth", "title": "Quorum update",
            "body": "Change the governance quorum to 10 percent.",
            "choices": ["For", "Against"], "state": "active",
        })
        facts = self.m.derive_record_facts(material, None)
        report = self.m.build_report(
            facts, material,
            {"kind": "snapshot", "space": "safe.eth", "proposalId": "quorum-1"},
            "run-quorum-1",
        )
        rendered = self.m.canonical(report).lower()
        self.assertEqual(report["findings"][0]["title"], "Governance control or rule change")
        self.assertNotIn("safe signer", rendered)
        self.assertNotIn("which safe", rendered)

    def test_tranche_operator_without_reviewer_does_not_invent_milestone_approval(self):
        material = self.m.canonical({
            "id": "tranche-1", "space": "safe.eth", "title": "Program operations",
            "body": "The program operator releases funds in tranches.",
            "choices": ["For", "Against"], "state": "active",
        })
        facts = self.m.derive_record_facts(material, None)
        report = self.m.build_report(
            facts, material,
            {"kind": "snapshot", "space": "safe.eth", "proposalId": "tranche-1"},
            "run-tranche-1",
        )
        rendered = self.m.canonical(report).lower()
        self.assertNotIn("milestone approval", rendered)
        self.assertNotIn("human milestone review", rendered)
        self.assertIn("program operator", report["executionMap"][0]["actor"].lower())

    def test_contract_exposes_immutable_schema_identity(self):
        owner = "0x" + "1" * 40
        operator = "0x" + "2" * 40
        self.m.gl.message.sender_address = owner
        contract = self.m.GovernanceDueDiligenceV33(operator, json.dumps(["safe.eth"]))
        self.assertEqual(json.loads(contract.get_contract_schema()), {
            "assessmentSchemaVersion": "3.3",
            "assessmentVersion": "3",
            "consensusMethod": "independent_structured_derivation_v3_3",
        })
        with self.assertRaisesRegex(UserError, "invalid operator"):
            self.m.GovernanceDueDiligenceV33("0x" + "0" * 40, json.dumps(["safe.eth"]))

    def test_returned_fund_tables_accept_one_through_five_unique_rows(self):
        safe_address = "0x" + "8" * 40
        safe = {
            "address": safe_address,
            "chainId": 1,
            "blockNumber": 1,
            "blockHash": "0x" + "a" * 64,
            "threshold": 1,
            "owners": ["0x" + "7" * 40],
            "providers": ["publicnode", "drpc"],
        }
        for row_count in range(1, 6):
            with self.subTest(row_count=row_count):
                material = table_material(self.m, row_count)
                table = self.m.extract_return_table(material)
                self.assertEqual(len(table["rows"]), row_count)
                returned = returned_funds_for(table, safe_address)
                facts = self.m.derive_record_facts(material, safe, "retrieved", returned, "retrieved")
                report = self.m.build_report(
                    facts,
                    material,
                    {"kind": "snapshot", "space": "safe.eth", "proposalId": "rows-" + str(row_count)},
                    "run-rows-" + str(row_count),
                )
                claim = next(item for item in report["materialClaims"] if "ETH returned" in item["claim"])
                self.assertEqual(claim["status"], "supported")
                self.assertEqual(len([item for item in report["evidence"] if item["type"] == "onchain"]), row_count)

    def test_returned_fund_tables_reject_six_or_duplicate_rows(self):
        with self.assertRaisesRegex(ValueError, "incomplete or oversized"):
            self.m.extract_return_table(table_material(self.m, 6))

        duplicate = self.m.canonical({"body":
            "| Label | Amount (ETH) | Return Tx |\n| --- | --- | --- |\n"
            "| First | 1.000000 | https://etherscan.io/tx/0x" + "1" * 64 + " |\n"
            "| Second | 1.000000 | https://etherscan.io/tx/0x" + "1" * 64 + " |\n"
            "| **Total** | 2.000000 | |"})
        with self.assertRaisesRegex(ValueError, "incomplete or oversized"):
            self.m.extract_return_table(duplicate)

        zero_rows = self.m.canonical({"body":
            "| Label | Amount (ETH) | Return Tx |\n| --- | --- | --- |\n"
            "| **Total** | 0.000000 | |"})
        with self.assertRaisesRegex(ValueError, "incomplete or oversized"):
            self.m.extract_return_table(zero_rows)

        malformed = self.m.canonical({"body":
            "| Label | Amount (ETH) | Return Tx |\n| --- | --- | --- |\n"
            "| First | not-an-amount | https://etherscan.io/tx/0x" + "1" * 64 + " |\n"
            "| **Total** | 1.000000 | |"})
        with self.assertRaisesRegex(ValueError, "invalid returned-funds row amount"):
            self.m.extract_return_table(malformed)

    def test_operator_and_space_authorization_protect_immutable_run_records(self):
        owner = "0x" + "1" * 40
        operator_1 = "0x" + "2" * 40
        operator_2 = "0x" + "3" * 40
        attacker = "0x" + "4" * 40
        proposal = {
            "id": "p1",
            "space": {"id": "safe.eth"},
            "title": "Fund community work",
            "body": "Transfer 10 ETH to the community treasury.",
            "choices": ["For", "Against"],
            "state": "active",
        }

        class Response:
            status = 200
            body = json.dumps({"data": {"proposal": proposal}}).encode()

        self.m.gl.nondet = types.SimpleNamespace(web=types.SimpleNamespace(get=lambda _url: Response()))
        self.m.gl.eq_principle = types.SimpleNamespace(strict_eq=lambda fn: fn())
        self.m.gl.vm.run_nondet_unsafe = lambda leader, validator: leader() if validator(Return(leader())) else None
        self.m.gl.message.sender_address = owner
        contract = self.m.GovernanceDueDiligenceV33(operator_1, json.dumps(["safe.eth"]))
        source = json.dumps({"kind": "snapshot", "space": "safe.eth", "proposalId": "p1"})

        self.m.gl.message.sender_address = attacker
        with self.assertRaisesRegex(UserError, "operator"):
            contract.assess(source, "run-1")

        self.m.gl.message.sender_address = operator_1
        record = json.loads(contract.assess(source, "run-1"))
        self.assertEqual(record["assessmentRunId"], "run-1")
        self.assertEqual(json.loads(contract.get_assessment_by_run("run-1"))["contentHash"], record["contentHash"])
        self.assertEqual(json.loads(contract.get_assessment_for_schema(record["proposalKey"], "3.3"))["assessmentRunId"], "run-1")
        first_bytes = contract.get_assessment_by_run("run-1")
        self.m.gl.nondet.web.get = lambda _url: (_ for _ in ()).throw(AssertionError("historical run fetched mutable source"))
        self.assertEqual(contract.assess(source, "run-1"), first_bytes)
        self.m.gl.nondet.web.get = lambda _url: Response()

        self.m.gl.message.sender_address = owner
        contract.set_operator(operator_2)
        contract.set_snapshot_space_allowed("safe.eth", False)

        self.m.gl.message.sender_address = attacker
        with self.assertRaisesRegex(UserError, "owner"):
            contract.set_operator(attacker)

        self.m.gl.message.sender_address = operator_1
        with self.assertRaisesRegex(UserError, "operator"):
            contract.assess(source, "run-2")
        self.m.gl.message.sender_address = operator_2
        with self.assertRaisesRegex(UserError, "allowlisted"):
            contract.assess(source, "run-2")

        self.m.gl.message.sender_address = owner
        contract.set_snapshot_space_allowed("safe.eth", True)
        self.m.gl.message.sender_address = operator_2
        second = json.loads(contract.assess(source, "run-2"))
        self.assertEqual(second["assessmentRunId"], "run-2")
        self.assertEqual(len(contract.assessments), 2)
        self.assertEqual(json.loads(contract.get_assessment_by_run("run-1"))["assessmentRunId"], "run-1")

    def test_run_id_cannot_be_rebound_to_another_proposal(self):
        owner = "0x" + "1" * 40
        operator = "0x" + "2" * 40
        self.m.gl.message.sender_address = owner
        contract = self.m.GovernanceDueDiligenceV33(operator, json.dumps(["safe.eth"]))
        contract.run_proposals["run-1"] = "snapshot:safe.eth:p1"
        contract.run_records["run-1"] = "run:run-1"
        contract.assessments["run:run-1"] = "{}"
        self.m.gl.message.sender_address = operator
        source = json.dumps({"kind": "snapshot", "space": "safe.eth", "proposalId": "p2"})
        with self.assertRaisesRegex(UserError, "another proposal"):
            contract.assess(source, "run-1")


if __name__ == "__main__":
    unittest.main()
