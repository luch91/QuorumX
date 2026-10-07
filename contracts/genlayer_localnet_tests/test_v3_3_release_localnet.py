"""Execution-success-gated localnet smoke for GovernanceDueDiligence v3.3."""

import json
from pathlib import Path

from gltest.assertions import tx_execution_succeeded
from gltest.contracts.contract_factory import ContractFactory, extract_contract_address
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
    assert tx_execution_succeeded(deploy_receipt)
    contract = factory.build_contract(extract_contract_address(deploy_receipt), account=default_account)

    schema = json.loads(contract.get_contract_schema().call())
    assert schema == {
        "assessmentSchemaVersion": "3.3",
        "assessmentVersion": "3",
        "consensusMethod": "independent_structured_derivation_v3_3",
    }

    run_id = "localnet-v33-release-smoke"
    write_receipt = contract.assess(args=[json.dumps(SOURCE), run_id]).transact(
        wait_interval=3000,
        wait_retries=150,
        wait_transaction_status=TransactionStatus.ACCEPTED,
    )
    assert tx_execution_succeeded(write_receipt)
    record = json.loads(contract.get_assessment_by_run(args=[run_id]).call())
    assert record["assessmentVersion"] == "3"
    assert record["assessmentSchemaVersion"] == "3.3"
    assert record["assessmentRunId"] == run_id
    assert record["proposalKey"] == f"snapshot:{SOURCE['space']}:{SOURCE['proposalId']}"
    assert record["contentHash"]
    assert record["evidence"]
