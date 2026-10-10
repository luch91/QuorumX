"""Five-validator localnet smoke for the schema-3.4 IR acceptance boundary."""

import json
from pathlib import Path

from gltest.assertions import tx_execution_succeeded
from gltest.clients import get_gl_client
from gltest.contracts.contract_factory import ContractFactory, extract_contract_address
from gltest.types import TransactionStatus


MATERIAL = (
    "The DAO multisig can recover the USDC by atomically calling "
    "`claimFees(FeeDistributor, USDC, DAO, 0)` four times."
)
CANDIDATE = {
    "proposalObjective": "Recover the USDC.",
    "actions": [{
        "id": "claim-fees", "operation": "token_claim", "actor": "DAO multisig",
        "function": "claimFees", "arguments": ["FeeDistributor", "USDC", "DAO", "0"],
        "asset": "USDC", "recipient": "DAO", "frequency": "4 calls",
        "conditions": [], "dependencies": [], "sourceExcerpt": MATERIAL,
    }],
    "claims": [], "safeguards": [], "executionConsequences": [],
    "unknowns": [], "evidenceReferences": [],
}


def test_v34_deploys_and_normalizes_a_grounded_candidate_on_five_validators(default_account):
    contract_path = Path(__file__).parents[1] / "decision_ir_v3_4.py"
    factory = ContractFactory.from_file_path(str(contract_path))
    deploy_receipt = factory.deploy_contract_tx(
        args=[], account=default_account, wait_interval=3000, wait_retries=100,
        wait_transaction_status=TransactionStatus.ACCEPTED,
    )
    assert tx_execution_succeeded(deploy_receipt), json.dumps(deploy_receipt, default=str, indent=2)
    address = extract_contract_address(deploy_receipt)
    client = get_gl_client()

    assert client.read_contract(
        address=address, function_name="get_schema", account=default_account, args=[],
    ) == "3.4"
    tx_hash = client.write_contract(
        address=address, function_name="normalize_candidate", account=default_account,
        args=[MATERIAL, json.dumps(CANDIDATE)],
    )
    receipt = client.wait_for_transaction_receipt(
        transaction_hash=tx_hash, interval=3000, retries=100,
        status=TransactionStatus.ACCEPTED,
    )
    assert tx_execution_succeeded(receipt), receipt
