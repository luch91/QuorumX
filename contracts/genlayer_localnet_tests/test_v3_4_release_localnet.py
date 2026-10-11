"""Five-validator deployment smoke for the self-contained schema-3.4 contract."""

import json
from pathlib import Path

from gltest.assertions import tx_execution_succeeded
from gltest.clients import get_gl_client
from gltest.contracts.contract_factory import ContractFactory, extract_contract_address
from gltest.types import TransactionStatus


def test_v34_contract_deploys_and_exposes_its_schema(default_account):
    factory = ContractFactory.from_file_path(str(Path(__file__).parents[1] / "governance_due_diligence_v3_4.py"))
    receipt = factory.deploy_contract_tx(
        args=[default_account.address, json.dumps(["balancer.eth", "safe.eth", "arbitrumfoundation.eth", "ens.eth"])],
        account=default_account, wait_interval=3000, wait_retries=100,
        wait_transaction_status=TransactionStatus.ACCEPTED,
    )
    assert tx_execution_succeeded(receipt), receipt
    address = extract_contract_address(receipt)
    schema = json.loads(get_gl_client().read_contract(
        address=address, function_name="get_contract_schema", account=default_account, args=[],
    ))
    assert schema == {
        "assessmentVersion": "3",
        "assessmentSchemaVersion": "3.4",
        "consensusMethod": "independent_structured_derivation_v3_4",
    }
