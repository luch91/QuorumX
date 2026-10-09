"""Direct Mode coverage for the immutable v3.3 contract boundary."""

import json
import os
from pathlib import Path

import pytest


SOURCE = {"kind": "snapshot", "space": "safe.eth", "proposalId": "generic-distribution-1"}
GENVM_SDK_VERSION = "v0.2.16"
SAFE_ADDRESS = "0x1111111111111111111111111111111111111111"
SAFE_OWNERS = [
    "0x2222222222222222222222222222222222222222",
    "0x3333333333333333333333333333333333333333",
    "0x4444444444444444444444444444444444444444",
]


@pytest.fixture(autouse=True)
def windows_genlayer_test_stdin_cleanup(monkeypatch, request):
    """Work around genlayer-test 0.29.2's unlink-before-close bug on Windows."""
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


def generic_fixture():
    path = Path(__file__).parents[2] / "fixtures" / "due_diligence_v3_3" / "generic_distribution.json"
    return json.loads(path.read_text(encoding="utf-8"))


def set_snapshot_body(vm, body, title="Runtime proposal", state="active", end=1893456000):
    vm.clear_mocks()
    vm.mock_web(
        r"^https://hub\.snapshot\.org/graphql\?",
        {
            "method": "GET",
            "status": 200,
            "body": json.dumps({
                "data": {
                    "proposal": {
                        "id": SOURCE["proposalId"],
                        "title": title,
                        "body": body,
                        "choices": ["For", "Against"],
                        "state": state,
                        "end": end,
                        "space": {"id": SOURCE["space"]},
                    }
                }
            }),
        },
    )


def set_snapshot_mock(vm):
    fixture = generic_fixture()
    set_snapshot_body(vm, fixture["body"], fixture["title"])


def returned_table_body(row_count):
    rows = []
    for index in range(row_count):
        tx_hash = "0x" + format(index + 1, "064x")
        rows.append(f"| Transfer {index + 1} | {index + 1}.000000 | https://etherscan.io/tx/{tx_hash} |")
    return "| Label | Amount (ETH) | Return Tx |\n| --- | --- | --- |\n" \
        + "\n".join(rows) \
        + f"\n| **Total** | {sum(range(1, row_count + 1))}.000000 | |"


def set_safe_mocks(vm, drpc_threshold, state="active", end=1893456000, historical_success=False):
    body = f"Ethereum Mainnet Safe address: {SAFE_ADDRESS} has threshold 2/3."
    vm.clear_mocks()
    vm.mock_web(
        r"^https://hub\.snapshot\.org/graphql\?",
        {
            "method": "GET",
            "status": 200,
            "body": json.dumps({"data": {"proposal": {
                "id": SOURCE["proposalId"], "title": "Safe review", "body": body,
                "choices": ["For", "Against"], "state": state, "end": end,
                "space": {"id": SOURCE["space"]},
            }}}),
        },
    )

    def rpc_handler(request):
        if historical_success and request["url"].startswith("https://eth.blockscout.com/api?"):
            return {"ok": {"response": {"status": 200, "headers": {}, "body": json.dumps({
                "status": "1", "result": {"blockNumber": "10"},
            }).encode()}}}
        payload = request["body"]
        if isinstance(payload, bytes):
            payload = payload.decode("utf-8")
        if isinstance(payload, str):
            payload = json.loads(payload)
        if isinstance(payload, list):
            responses = []
            for item in payload:
                method = item["method"]
                if method == "eth_chainId":
                    result = "0x1"
                elif method == "eth_getBlockByNumber":
                    number = int(item["params"][0], 16)
                    result = {"number": hex(number), "hash": "0x" + ("a" if number == 10 else "b") * 64,
                              "timestamp": hex(end - 1 if number == 10 else end + 1)}
                elif method == "eth_call" and item["params"][0]["data"] == "0xe75235b8":
                    result = "0x" + format(2, "064x")
                elif method == "eth_call" and item["params"][0]["data"] == "0xa0e67e2b":
                    result = "0x" + format(32, "064x") + format(len(SAFE_OWNERS), "064x")
                    result += "".join(owner[2:].rjust(64, "0") for owner in SAFE_OWNERS)
                responses.append({"jsonrpc": "2.0", "id": item["id"], "result": result})
            return {"ok": {"response": {"status": 200, "headers": {}, "body": json.dumps(responses).encode()}}}
        method = payload["method"]
        if method == "eth_chainId":
            result = "0x1"
        elif method == "eth_getBlockByNumber":
            result = {"number": "0x18e9a38", "hash": "0x" + "a" * 64}
        elif method == "eth_call" and payload["params"][0]["data"] == "0xe75235b8":
            threshold = drpc_threshold if request["url"] == "https://eth.drpc.org" else 2
            result = "0x" + format(threshold, "064x")
        elif method == "eth_call" and payload["params"][0]["data"] == "0xa0e67e2b":
            result = "0x" + format(32, "064x") + format(len(SAFE_OWNERS), "064x")
            result += "".join(owner[2:].rjust(64, "0") for owner in SAFE_OWNERS)
        else:
            raise AssertionError(f"Unexpected RPC request: {payload}")
        response = {"jsonrpc": "2.0", "id": payload.get("id"), "result": result}
        return {"ok": {"response": {"status": 200, "headers": {}, "body": json.dumps(response).encode()}}}

    vm._live_web_handler = rpc_handler


def test_v33_generic_distribution_is_source_grounded_and_reproducible(
        direct_vm, direct_deploy, direct_owner, direct_alice):
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_3.py",
        operator,
        json.dumps(["safe.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    set_snapshot_mock(direct_vm)
    direct_vm.sender = direct_alice

    record = json.loads(contract.assess(json.dumps(SOURCE), "direct-v33-generic-1"))

    rendered = json.dumps(record).lower()
    assert record["assessmentSchemaVersion"] == "3.3"
    assert record["assessmentRunId"] == "direct-v33-generic-1"
    assert record["materialActions"][0]["id"] == "a1"
    assert record["findings"][0]["relatedActionIds"] == ["a1"]
    assert "pre-exploit block 25872248" not in rendered
    assert "per-pool allocations" not in rendered
    assert "claim contract" not in rendered
    assert direct_vm.run_validator() is True


def test_v33_retrospective_context_runs_in_genvm(
        direct_vm, direct_deploy, direct_owner, direct_alice):
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_3.py",
        operator,
        json.dumps(["safe.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    set_snapshot_body(direct_vm, "Publish a retrospective incident report.",
                      state="closed", end=1791309600)
    direct_vm.sender = direct_alice

    record = json.loads(contract.assess(json.dumps(SOURCE), "direct-v33-retrospective"))

    assert record["assessmentContext"] == "retrospective"
    assert record["proposalCloseTime"] == "2026-10-06T18:00:00Z"
    assert direct_vm.run_validator() is True


def test_v33_retrospective_safe_falls_back_without_historical_upgrade_in_genvm(
        direct_vm, direct_deploy, direct_owner, direct_alice):
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_3.py",
        operator,
        json.dumps(["safe.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    set_safe_mocks(direct_vm, drpc_threshold=2, state="closed", end=1791309600)
    direct_vm.sender = direct_alice

    record = json.loads(contract.assess(json.dumps(SOURCE), "direct-v33-retrospective-safe"))
    claim = next(item for item in record["materialClaims"] if item["claimScope"] == "external_factual")

    assert record["assessmentContext"] == "retrospective"
    assert record["externalEvidenceState"] == "retrieved"
    assert record["externalEvidenceFailureCode"] == "rpc_historical_state_unavailable"
    assert claim["status"] == "unverified"
    assert direct_vm.run_validator() is True


def test_v33_retrospective_safe_historical_success_runs_in_genvm(
        direct_vm, direct_deploy, direct_owner, direct_alice):
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_3.py",
        operator,
        json.dumps(["safe.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    set_safe_mocks(direct_vm, drpc_threshold=2, state="closed", end=1791309600,
                   historical_success=True)
    direct_vm.sender = direct_alice

    record = json.loads(contract.assess(json.dumps(SOURCE), "direct-v33-retrospective-historical"))
    claim = next(item for item in record["materialClaims"] if item["claimScope"] == "external_factual")

    assert record["assessmentContext"] == "retrospective"
    assert record["externalEvidenceFailureCode"] == ""
    assert record["evidence"][1]["temporal"]["temporalScope"] == "historically_anchored"
    assert claim["status"] == "supported"
    assert direct_vm.run_validator() is True


def test_v33_rejects_unauthorized_writer_and_disallowed_space(
        direct_vm, direct_deploy, direct_owner, direct_alice, direct_bob):
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_3.py",
        operator,
        json.dumps(["safe.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    set_snapshot_mock(direct_vm)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("only configured operator"):
        contract.assess(json.dumps(SOURCE), "direct-v33-unauthorized")

    direct_vm.sender = direct_owner
    contract.set_snapshot_space_allowed("safe.eth", False)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("not allowlisted"):
        contract.assess(json.dumps(SOURCE), "direct-v33-disallowed")


def test_v33_validator_rejects_different_decision_bearing_safe_state(
        direct_vm, direct_deploy, direct_owner, direct_alice):
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_3.py",
        operator,
        json.dumps(["safe.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    set_safe_mocks(direct_vm, drpc_threshold=2)
    direct_vm.sender = direct_alice
    record = json.loads(contract.assess(json.dumps(SOURCE), "direct-v33-safe-state"))
    claim = next(item for item in record["materialClaims"] if item["claimScope"] == "external_factual")
    assert claim["status"] == "supported"

    set_safe_mocks(direct_vm, drpc_threshold=3)
    assert direct_vm.run_validator() is False


@pytest.mark.parametrize("row_count", [1, 2, 4, 5])
def test_v33_accepts_bounded_dynamic_returned_fund_cardinality(
        direct_vm, direct_deploy, direct_owner, direct_alice, row_count):
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_3.py",
        operator,
        json.dumps(["safe.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    set_snapshot_body(direct_vm, returned_table_body(row_count), "Returned funds")
    direct_vm.sender = direct_alice

    record = json.loads(contract.assess(json.dumps(SOURCE), f"direct-v33-rows-{row_count}"))
    claim = next(item for item in record["materialClaims"] if "ETH returned" in item["claim"])
    assert f"in {row_count} transactions" in claim["claim"]
    assert claim["status"] == "unverified"
    assert record["returnedFundsState"] == "unavailable"
    assert direct_vm.run_validator() is True


def set_governance_history_handler(vm, prior_amount):
    prior_id = "0x" + "a" * 64
    body = (f"Snapshot proposal https://snapshot.box/#/s:safe.eth/proposal/{prior_id} "
            "requested 3M ARB.")
    vm.clear_mocks()

    def handler(request):
        if "id_in" in request["url"]:
            payload = {"data": {"proposals": [{
                "id": prior_id, "title": "Prior allocation",
                "body": f"Transfer {prior_amount} ARB to the grants program.",
                "choices": ["For", "Against"], "state": "closed",
                "space": {"id": "safe.eth"},
            }]}}
        else:
            payload = {"data": {"proposal": {
                "id": SOURCE["proposalId"], "title": "Follow-up", "body": body,
                "choices": ["For", "Against"], "state": "active", "end": 1893456000,
                "space": {"id": "safe.eth"},
            }}}
        return {"ok": {"response": {"status": 200,
            "headers": {"content-type": b"application/json"},
            "body": json.dumps(payload).encode()}}}

    vm._live_web_handler = handler


def test_v33_governance_history_is_validator_retrieved_and_disagreement_rejects(
        direct_vm, direct_deploy, direct_owner, direct_alice):
    operator = "0x" + bytes(direct_alice).hex()
    direct_vm.sender = direct_owner
    contract = direct_deploy(
        "contracts/governance_due_diligence_v3_3.py",
        operator,
        json.dumps(["safe.eth"]),
        sdk_version=GENVM_SDK_VERSION,
    )
    set_governance_history_handler(direct_vm, "3M")
    direct_vm.sender = direct_alice

    record = json.loads(contract.assess(json.dumps(SOURCE), "direct-v33-history"))
    claim = next(item for item in record["materialClaims"] if "requested 3M ARB" in item["claim"])
    assert claim["status"] == "supported"
    assert claim["evidence"] == ["proposal", "governance-history-1"]
    assert record["externalEvidenceStates"]["governanceHistory"] == "retrieved"
    assert direct_vm.run_validator() is True

    set_governance_history_handler(direct_vm, "4M")
    assert direct_vm.run_validator() is False
