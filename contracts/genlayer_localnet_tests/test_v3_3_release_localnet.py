"""Execution-success-gated localnet smoke for GovernanceDueDiligence v3.3."""

import json
from pathlib import Path

from gltest.assertions import tx_execution_succeeded
from gltest.contracts.contract_factory import ContractFactory, extract_contract_address
from gltest.clients import get_gl_client
from gltest.types import TransactionStatus


SOURCE = {
    "kind": "snapshot",
    "space": "balancer.eth",
    "proposalId": "0x62d9add4f2184153aba3d2d44c9e9d44d90db76676f8335eb7f8ffb7d52d98e5",
}


def test_v33_deploy_write_and_read_require_successful_execution(default_account):
    contract_path = Path(__file__).parents[1] / "governance_due_diligence_v3_3.py"
    factory = ContractFactory.from_file_path(str(contract_path))
    deploy_receipt = factory.deploy_contract_tx(
        args=[default_account.address, json.dumps(["balancer.eth", "safe.eth", "arbitrumfoundation.eth", "ens.eth"])],
        account=default_account,
        wait_interval=3000,
        wait_retries=100,
        wait_transaction_status=TransactionStatus.ACCEPTED,
    )
    assert tx_execution_succeeded(deploy_receipt), deploy_receipt
    contract_address = extract_contract_address(deploy_receipt)
    client = get_gl_client()

    schema = json.loads(client.read_contract(
        address=contract_address, function_name="get_contract_schema", account=default_account, args=[],
    ))
    assert schema == {
        "assessmentSchemaVersion": "3.3",
        "assessmentVersion": "3",
        "consensusMethod": "independent_structured_derivation_v3_3",
    }

    run_id = "localnet-v33-release-smoke"
    sent_hashes = []
    original_request = client.provider.make_request

    def capture_request(method, params):
        response = original_request(method=method, params=params)
        if method == "eth_sendRawTransaction" and response.get("result"):
            sent_hashes.append(response["result"])
        return response

    client.provider.make_request = capture_request
    try:
        write_hash = client.write_contract(
            address=contract_address, function_name="assess", account=default_account,
            args=[json.dumps(SOURCE), run_id],
        )
    except Exception:
        if sent_hashes:
            outer_receipt = original_request(
                method="eth_getTransactionReceipt", params=[sent_hashes[-1]])
            print("failed outer receipt:", json.dumps(outer_receipt, default=str))
            logs = outer_receipt.get("result", {}).get("logs", [])
            if logs and len(logs[0].get("topics", [])) > 1:
                genlayer_hash = logs[0]["topics"][1]
                try:
                    print("failed GenLayer transaction:", json.dumps(
                        client.get_transaction(transaction_hash=genlayer_hash), default=str))
                except Exception as transaction_error:
                    print("GenLayer transaction unavailable:", repr(transaction_error))
            try:
                print("failed outer trace:", json.dumps(original_request(
                    method="debug_traceTransaction", params=[sent_hashes[-1], {}]), default=str))
            except Exception as trace_error:
                print("outer trace unavailable:", repr(trace_error))
        raise
    write_receipt = client.wait_for_transaction_receipt(
        transaction_hash=write_hash, interval=3000, retries=150,
        status=TransactionStatus.ACCEPTED,
    )
    assert tx_execution_succeeded(write_receipt), write_receipt
    record = json.loads(client.read_contract(
        address=contract_address, function_name="get_assessment_by_run", account=default_account, args=[run_id],
    ))
    assert record["assessmentVersion"] == "3"
    assert record["assessmentSchemaVersion"] == "3.3"
    assert record["assessmentRunId"] == run_id
    assert record["proposalKey"] == f"snapshot:{SOURCE['space']}:{SOURCE['proposalId']}"
    assert record["contentHash"]
    assert record["evidence"]
