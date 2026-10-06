# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""V3.3: immutable, operator-authorized structured due diligence.

V1, V2, and the schema 3.2 evaluation contract are intentionally not modified.
Schema 3.3 checks Safe configuration through two fixed Ethereum-mainnet RPC
providers at a common block pin. Provider responses are secondary evidence,
not cryptographic proofs. Reports are stored by immutable assessment-run ID.
"""

from genlayer import *
import hashlib
import json
import re
from urllib.parse import quote

MAX_RECORD_BYTES = 22000
BLOCKSCOUT_TX_API = "https://eth.blockscout.com/api/v2/transactions/"
BLOCKSCOUT_BLOCK_API = "https://eth.blockscout.com/api/v2/blocks/"
BLOCKSCOUT_TX_PAGE = "https://eth.blockscout.com/tx/"
ETHEREUM_RPC_PROVIDERS = (
    ("publicnode", "https://ethereum-rpc.publicnode.com"),
    ("drpc", "https://eth.drpc.org"),
)
RETURN_TX = re.compile(r"https://etherscan\.io/tx/(0x[0-9a-f]{64})", re.I)
SAFE_ADDRESS = re.compile(r"(?<![0-9A-Fa-f])0x[0-9A-Fa-f]{40}(?![0-9A-Fa-f])")
SAFE_CONTRACT_ADDRESS = re.compile(
    r"\b(?:safe|multisig)(?:\s+(?:contract|address))?(?:\s*(?::|=|\bis\b|\bat\b)\s*|\s+on\s+ethereum\s+mainnet\s+)"
    r"(?:address\s*)?\(?\s*(?:`{1,3})?(0x[0-9A-Fa-f]{40})",
    re.I,
)
MAINNET_SCOPE = re.compile(r"\b(ethereum\s+mainnet|ethereum\s+chain\s*(?:id\s*)?1|eip155:1)\b", re.I)
TREASURY_ACTION = re.compile(r"\b(?:transfer|send|allocate|fund|disburse|grant)\b", re.I)
TRANSFER_AMOUNT = re.compile(
    r"\b(?P<amount>\d[\d,]*(?:\.\d+)?\s*(?:million|billion|[kmb])?)\s*"
    r"(?P<asset>ARB|BAL|ETH|USDC|DAI|USD)\b", re.I,
)
CONTROL_CALL = re.compile(r"\b(?:swapOwner|addOwner|removeOwner|changeThreshold|setThreshold|grantRole|revokeRole)\s*\([^)]{0,100}\)", re.I)
CONTROL_CHANGE = re.compile(
    r"\b(?:replace|remove|add|appoint|rotate|nominate|revoke|grant|change|increase|decrease)\b.{0,80}"
    r"\b(?:owner|signer|council member|governance role|permission|quorum|threshold)\b", re.I,
)
DISTRIBUTION_ACTION = re.compile(
    r"^\s*(?:distribution|disbursement)\s+of\s+(.{1,80}?)\s+to\s+(.{1,80}?)\s+shall\s+be\s*:?\s*$",
    re.I,
)
METRIC_CLAIM = re.compile(
    r"(?:\$\s?\d[\d,.]*|\b\d[\d,.]*\s*(?:%|(?:million|billion|[kmb])\s*)?(?:users?|members?|active addresses|"
    r"transactions?|votes?|USD|ARB|BAL|ETH|USDC|DAI)|revenue|trading volume|monthly active|"
    r"no further funding|audited|confirmed via|verified via|signature was verified)\b", re.I,
)
SAFE_THRESHOLD = re.compile(r"\b(\d{1,2})\s*(?:/|of)\s*(\d{1,2})\b", re.I)

_KECCAK_ROT = (
    (0, 36, 3, 41, 18), (1, 44, 10, 45, 2), (62, 6, 43, 15, 61),
    (28, 55, 25, 21, 56), (27, 20, 39, 8, 14),
)
_KECCAK_RC = (
    0x0000000000000001, 0x0000000000008082, 0x800000000000808A,
    0x8000000080008000, 0x000000000000808B, 0x0000000080000001,
    0x8000000080008081, 0x8000000000008009, 0x000000000000008A,
    0x0000000000000088, 0x0000000080008009, 0x000000008000000A,
    0x000000008000808B, 0x800000000000008B, 0x8000000000008089,
    0x8000000000008003, 0x8000000000008002, 0x8000000000000080,
    0x000000000000800A, 0x800000008000000A, 0x8000000080008081,
    0x8000000000008080, 0x0000000080000001, 0x8000000080008008,
)


def keccak256(data):
    """Minimal Keccak-256 (Ethereum variant; not NIST SHA3-256)."""
    rate = 136
    padded = bytearray(data)
    padding_length = rate - (len(padded) % rate)
    if padding_length == 1:
        padded.append(0x81)
    else:
        padded.append(0x01)
        padded.extend(b"\x00" * (padding_length - 2))
        padded.append(0x80)
    state = [0] * 25
    mask = 0xFFFFFFFFFFFFFFFF
    for offset in range(0, len(padded), rate):
        block = padded[offset:offset + rate]
        for lane in range(rate // 8):
            state[lane] ^= int.from_bytes(block[lane * 8:lane * 8 + 8], "little")
        for rc in _KECCAK_RC:
            columns = [state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20] for x in range(5)]
            delta = [columns[(x - 1) % 5] ^ (((columns[(x + 1) % 5] << 1) | (columns[(x + 1) % 5] >> 63)) & mask) for x in range(5)]
            for y in range(5):
                for x in range(5):
                    state[x + 5 * y] ^= delta[x]
            rotated = [0] * 25
            for y in range(5):
                for x in range(5):
                    value = state[x + 5 * y]
                    shift = _KECCAK_ROT[x][y]
                    rotated[y + 5 * ((2 * x + 3 * y) % 5)] = (((value << shift) | (value >> ((64 - shift) % 64))) & mask)
            for y in range(5):
                for x in range(5):
                    state[x + 5 * y] = rotated[x + 5 * y] ^ ((~rotated[(x + 1) % 5 + 5 * y]) & rotated[(x + 2) % 5 + 5 * y])
            state[0] ^= rc
    return b"".join(state[lane].to_bytes(8, "little") for lane in range(rate // 8))[:32]


def checksum_address(address):
    if not isinstance(address, str) or not SAFE_ADDRESS.fullmatch(address):
        raise ValueError("invalid Safe address")
    lower = address[2:].lower()
    hashed = keccak256(lower.encode("ascii")).hex()
    return "0x" + "".join(char.upper() if int(hashed[index], 16) >= 8 else char
                          for index, char in enumerate(lower))


def safe_candidate_from_passage(passage):
    """Return an explicitly labelled mainnet Safe address, never a signer.

    Proposal tables often put a Safe name beside owner/signer address columns.
    A generic address on a line mentioning both Ethereum and Safe is not enough
    to establish that the address is the Safe contract itself.
    """
    if not isinstance(passage, str) or not MAINNET_SCOPE.search(passage):
        return ""
    match = SAFE_CONTRACT_ADDRESS.search(passage)
    return match.group(1).lower() if match else ""


def safe_candidate_from_material(material):
    """Find a mainnet Safe contract in explicit prose or a labelled table.

    For tables, addresses are accepted only from a column explicitly headed
    Safe/Safe address and a same-row Ethereum Mainnet/chain-id-1 cell. An
    adjacent Old Owner/New Owner address is never promoted to the Safe.
    """
    passages = split_passages(material)
    for passage in passages:
        candidate = safe_candidate_from_passage(passage)
        if candidate:
            return candidate

    headers = []
    for index, passage in enumerate(passages):
        if "|" not in passage:
            continue
        cells = [cell.strip().strip("`*_").strip().lower() for cell in passage.strip("|").split("|")]
        if not any(re.search(r"\bchain\b|\bnetwork\b", cell) for cell in cells):
            continue
        safe_columns = [i for i, cell in enumerate(cells)
                        if re.fullmatch(r"(?:ethereum\s+)?(?:safe|safe\s+(?:contract|address)|multisig(?:\s+address)?)", cell)]
        chain_columns = [i for i, cell in enumerate(cells)
                         if re.search(r"\bchain\b|\bnetwork\b", cell)]
        headers.append((index, safe_columns, chain_columns, len(cells)))

    for header_index, safe_columns, chain_columns, width in headers:
        if len(safe_columns) != 1 or len(chain_columns) != 1:
            continue
        safe_column = safe_columns[0]
        chain_column = chain_columns[0]
        for passage in passages[header_index + 1:header_index + 5]:
            if "|" not in passage:
                if passage:
                    break
                continue
            cells = [cell.strip().strip("`*_").strip() for cell in passage.strip("|").split("|")]
            if len(cells) != width or safe_column >= len(cells) or chain_column >= len(cells):
                continue
            chain = cells[chain_column]
            if not re.search(r"\b(?:ethereum\s+mainnet|mainnet|eip155:1|chain\s*(?:id\s*)?1)\b", chain, re.I):
                continue
            value = cells[safe_column]
            if re.fullmatch(r"0x[0-9A-Fa-f]{40}", value):
                return value.lower()
    return ""


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def bounded(value, field, limit, optional=False):
    if not isinstance(value, str) or len(value) > limit or (not optional and not value.strip()):
        raise ValueError("invalid " + field)
    return value.strip()


def source_for(raw):
    if not isinstance(raw, str) or len(raw) > 4096:
        raise ValueError("invalid source")
    source = json.loads(raw)
    if not isinstance(source, dict) or set(source) != {"kind", "space", "proposalId"} or source.get("kind") != "snapshot":
        raise ValueError("v3 requires Snapshot source")
    space = bounded(source.get("space"), "space", 128)
    proposal_id = bounded(source.get("proposalId"), "proposal ID", 128)
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", space) or not re.fullmatch(r"[A-Za-z0-9_-]+", proposal_id):
        raise ValueError("invalid Snapshot identity")
    return {"kind": "snapshot", "space": space, "proposalId": proposal_id}


def snapshot_url(proposal_id):
    query = "query Proposal($id: String!) { proposal(id: $id) { id title body choices state space { id } } }"
    return "https://hub.snapshot.org/graphql?query=" + quote(query, safe="") + "&variables=" + quote(canonical({"id": proposal_id}), safe="")


def fetch_proposal(source):
    response = gl.nondet.web.get(snapshot_url(source["proposalId"]))
    if response.status != 200:
        raise ValueError("Snapshot source returned a non-success HTTP status")
    body = response.body.decode("utf-8") if isinstance(response.body, bytes) else str(response.body)
    if len(body.encode("utf-8")) > 64000:
        raise ValueError("Snapshot response exceeds limit")
    proposal = json.loads(body).get("data", {}).get("proposal")
    if not proposal or proposal.get("id") != source["proposalId"] or proposal.get("space", {}).get("id") != source["space"]:
        raise ValueError("Snapshot identity mismatch")
    material = canonical({"id": proposal["id"], "space": proposal["space"]["id"],
                          "title": proposal.get("title", ""), "body": proposal.get("body", ""),
                          "choices": proposal.get("choices", []), "state": proposal.get("state", "")})
    if len(material.encode("utf-8")) > 24000:
        raise ValueError("proposal material exceeds limit")
    return material


def _rpc_call(provider_url, method, params, request_id):
    """Call a fixed, read-only Ethereum JSON-RPC method with bounded output."""
    provider_name = next((name for name, url in ETHEREUM_RPC_PROVIDERS if url == provider_url), "unknown")
    payload = {"jsonrpc": "2.0", "method": method, "params": params, "id": request_id}
    try:
        response = gl.nondet.web.request(provider_url, method="POST", body=canonical(payload),
                                          headers={"content-type": "application/json"})
    except Exception:
        raise ValueError("rpc_" + provider_name + "_request_error") from None
    status = getattr(response, "status", getattr(response, "status_code", None))
    if status != 200:
        if type(status) is not int or not 100 <= status <= 599:
            raise ValueError("rpc_" + provider_name + "_invalid_http_status")
        raise ValueError("rpc_" + provider_name + "_http_" + str(status))
    try:
        body = response.body.decode("utf-8") if isinstance(response.body, bytes) else str(response.body)
    except Exception:
        raise ValueError("rpc_" + provider_name + "_invalid_body") from None
    if len(body.encode("utf-8")) > 64000:
        raise ValueError("rpc_" + provider_name + "_response_too_large")
    try:
        result = json.loads(body)
    except Exception:
        raise ValueError("rpc_" + provider_name + "_invalid_json") from None
    if not isinstance(result, dict) or result.get("jsonrpc") != "2.0" or result.get("id") != request_id \
            or "result" not in result:
        raise ValueError("rpc_" + provider_name + "_invalid_envelope")
    if "error" in result:
        raise ValueError("rpc_" + provider_name + "_remote_error")
    return result["result"]


def _decode_safe_threshold(value):
    if not isinstance(value, str) or not re.fullmatch(r"0x[0-9a-fA-F]{64}", value):
        raise ValueError("invalid Safe threshold ABI result")
    threshold = int(value[2:], 16)
    if not 1 <= threshold <= 20:
        raise ValueError("Safe threshold outside supported bound")
    return threshold


def _decode_safe_owners(value):
    if not isinstance(value, str) or not re.fullmatch(r"0x(?:[0-9a-fA-F]{64})+", value):
        raise ValueError("invalid Safe owners ABI result")
    raw = value[2:]
    offset = int(raw[:64], 16)
    if offset != 32 or len(raw) < 128:
        raise ValueError("invalid Safe owners ABI offset")
    count = int(raw[64:128], 16)
    if not 1 <= count <= 20 or len(raw) != 128 + count * 64:
        raise ValueError("invalid Safe owner count or ABI length")
    owners = []
    for index in range(count):
        word = raw[128 + index * 64:128 + (index + 1) * 64]
        if word[:24] != "0" * 24:
            raise ValueError("invalid address padding in Safe owner data")
        owner = "0x" + word[24:].lower()
        if owner == "0x" + "0" * 40:
            raise ValueError("zero Safe owner")
        owners.append(owner)
    if len(set(owners)) != len(owners):
        raise ValueError("duplicate Safe owners")
    return sorted(owners)


def _hex_quantity(value, field):
    if not isinstance(value, str) or not re.fullmatch(r"0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)", value):
        raise ValueError("invalid Ethereum RPC " + field)
    return int(value, 16)


def fetch_safe_onchain(address, block_pin=None):
    """Read the proposal-identified Safe from two fixed RPC endpoints.

    The leader selects an Ethereum finalized block. Validators receive that
    block pin from the leader result and independently query that same height.
    Provider responses are not cryptographic proofs, so resulting evidence is
    explicitly marked secondary.
    """
    if not SAFE_ADDRESS.fullmatch(address):
        raise ValueError("rpc_invalid_safe_address")
    primary_name, primary_url = ETHEREUM_RPC_PROVIDERS[0]
    secondary_name, secondary_url = ETHEREUM_RPC_PROVIDERS[1]
    primary_chain = _rpc_call(primary_url, "eth_chainId", [], 1)
    secondary_chain = _rpc_call(secondary_url, "eth_chainId", [], 1)
    if primary_chain != "0x1" or secondary_chain != "0x1":
        raise ValueError("rpc_not_mainnet")

    if block_pin is None:
        finalized = _rpc_call(primary_url, "eth_getBlockByNumber", ["finalized", False], 2)
        if not isinstance(finalized, dict):
            raise ValueError("rpc_no_finalized_block")
        block_number = _hex_quantity(finalized.get("number"), "block number")
        block_hash = finalized.get("hash", "").lower()
    else:
        if not isinstance(block_pin, dict):
            raise ValueError("rpc_invalid_block_pin")
        block_number = block_pin.get("blockNumber")
        block_hash = block_pin.get("blockHash", "")
        if type(block_number) is not int or block_number < 1 or not re.fullmatch(r"0x[0-9a-f]{64}", block_hash):
            raise ValueError("rpc_invalid_block_pin")
    if not re.fullmatch(r"0x[0-9a-f]{64}", block_hash):
        raise ValueError("rpc_invalid_block_hash")

    block_tag = "0x" + format(block_number, "x")
    for provider_url in (primary_url, secondary_url):
        block = _rpc_call(provider_url, "eth_getBlockByNumber", [block_tag, False], 2)
        if not isinstance(block, dict) or _hex_quantity(block.get("number"), "block number") != block_number \
                or str(block.get("hash", "")).lower() != block_hash:
            raise ValueError("rpc_block_disagreement")

    request = {"to": address, "data": "0xe75235b8"}
    threshold_results = [_rpc_call(url, "eth_call", [request, block_tag], 3) for _, url in ETHEREUM_RPC_PROVIDERS]
    request = {"to": address, "data": "0xa0e67e2b"}
    owners_results = [_rpc_call(url, "eth_call", [request, block_tag], 4) for _, url in ETHEREUM_RPC_PROVIDERS]
    if threshold_results[0] != threshold_results[1] or owners_results[0] != owners_results[1]:
        raise ValueError("rpc_safe_call_disagreement")
    try:
        threshold = _decode_safe_threshold(threshold_results[0])
    except Exception:
        raise ValueError("rpc_safe_threshold_invalid") from None
    try:
        owners = _decode_safe_owners(owners_results[0])
    except Exception:
        raise ValueError("rpc_safe_owners_invalid") from None
    if threshold > len(owners):
        raise ValueError("rpc_safe_threshold_exceeds_owners")
    return {"address": address.lower(), "chainId": 1, "blockNumber": block_number,
            "blockHash": block_hash, "threshold": threshold, "owners": owners,
            "providers": [primary_name, secondary_name]}


def extract_return_table(material):
    """Read only a bounded Markdown ETH return table with an explicit total."""
    body = json.loads(material).get("body", "")
    lines = body.replace("\r\n", "\n").split("\n")
    for index, line in enumerate(lines):
        if "|" not in line:
            continue
        headers = [re.sub(r"[*`_]", "", cell).strip().lower()
                   for cell in line.strip().strip("|").split("|")]
        amount_columns = [i for i, cell in enumerate(headers) if cell == "amount (eth)"]
        tx_columns = [i for i, cell in enumerate(headers) if cell == "return tx"]
        if len(amount_columns) != 1 or len(tx_columns) != 1:
            continue
        rows = []
        total = ""
        total_excerpt = ""
        for row_line in lines[index + 1:index + 10]:
            if "|" not in row_line:
                if row_line.strip():
                    break
                continue
            cells = [cell.strip() for cell in row_line.strip().strip("|").split("|")]
            if len(cells) != len(headers):
                continue
            amount_cell = re.sub(r"[*`_]", "", cells[amount_columns[0]]).strip()
            tx_match = RETURN_TX.search(cells[tx_columns[0]])
            if re.search(r"\btotal\b", " ".join(cells), re.I):
                if not re.fullmatch(r"\d{1,12}(?:\.\d{1,6})?", amount_cell):
                    raise ValueError("invalid returned-funds total")
                total = amount_cell
                total_excerpt = row_line[:240]
                continue
            if not tx_match:
                continue
            if not re.fullmatch(r"\d{1,12}(?:\.\d{1,6})?", amount_cell):
                raise ValueError("invalid returned-funds row amount")
            rows.append({"transactionHash": tx_match.group(1).lower(), "amountEth": amount_cell,
                         "sourceExcerpt": row_line[:240]})
        if not rows or len(rows) > 5 or not total or len({row["transactionHash"] for row in rows}) != len(rows):
            raise ValueError("incomplete or oversized returned-funds table")
        scale = 10 ** 6
        def micro_eth(value):
            parts = value.split(".")
            return int(parts[0]) * scale + int((parts[1] if len(parts) > 1 else "").ljust(6, "0"))
        if sum(micro_eth(row["amountEth"]) for row in rows) != micro_eth(total):
            raise ValueError("returned-funds table total does not equal its rows")
        return {"rows": rows, "totalEth": total, "totalExcerpt": total_excerpt}
    return None


def fetch_returned_funds(table, safe_address):
    if not table or not safe_address:
        raise ValueError("returned-funds evidence lacks a proposal table or Safe")

    def get_json(url):
        response = gl.nondet.web.get(url)
        if response.status != 200:
            raise ValueError("Blockscout returned a non-success HTTP status")
        body = response.body.decode("utf-8") if isinstance(response.body, bytes) else str(response.body)
        if len(body.encode("utf-8")) > 200000:
            raise ValueError("Blockscout response exceeds limit")
        parsed = json.loads(body)
        if not isinstance(parsed, dict):
            raise ValueError("invalid Blockscout response")
        return parsed

    def micro_eth_from_wei(value):
        if not isinstance(value, str) or not re.fullmatch(r"\d{1,30}", value):
            raise ValueError("invalid transaction value")
        return int(value) // (10 ** 12)

    def expected_micro_eth(value):
        parts = value.split(".")
        return int(parts[0]) * 1000000 + int((parts[1] if len(parts) > 1 else "").ljust(6, "0"))

    results = []
    for row in table["rows"]:
        tx_hash = row["transactionHash"]
        tx = get_json(BLOCKSCOUT_TX_API + tx_hash)
        if tx.get("hash", "").lower() != tx_hash or tx.get("result") != "success":
            raise ValueError("transaction is not a successful matching Ethereum mainnet transaction")
        block_number = tx.get("block_number")
        if type(block_number) is not int or block_number < 1:
            raise ValueError("transaction is missing a valid block number")
        block = get_json(BLOCKSCOUT_BLOCK_API + str(block_number))
        block_hash = block.get("hash", "")
        if block.get("height") != block_number or not re.fullmatch(r"0x[0-9a-fA-F]{64}", block_hash):
            raise ValueError("transaction block lookup did not match its block number")
        target = tx.get("to")
        target_address = target.get("hash", "").lower() if isinstance(target, dict) else ""
        tx_value = tx.get("value", "")
        matching = []
        if target_address == safe_address.lower() and micro_eth_from_wei(tx_value) == expected_micro_eth(row["amountEth"]):
            matching.append({"from": str(tx.get("from", {}).get("hash", "")).lower(),
                             "to": safe_address.lower(), "valueWei": tx_value,
                             "transferType": "transaction_value", "internalTransactionIndex": None,
                             "blockNumber": block_number})
        else:
            trace = get_json(BLOCKSCOUT_TX_API + tx_hash + "/internal-transactions")
            items = trace.get("items")
            if not isinstance(items, list) or len(items) > 100:
                raise ValueError("invalid internal transaction trace size")
            for item in items:
                if not isinstance(item, dict) or item.get("success") is not True or item.get("type") != "call":
                    continue
                recipient = item.get("to")
                if not isinstance(recipient, dict) or recipient.get("hash", "").lower() != safe_address.lower():
                    continue
                if item.get("transaction_hash", "").lower() != tx_hash or item.get("block_number") != block_number:
                    continue
                value_wei = item.get("value", "")
                if micro_eth_from_wei(value_wei) == expected_micro_eth(row["amountEth"]):
                    sender = item.get("from")
                    if not isinstance(sender, dict) or not SAFE_ADDRESS.fullmatch(str(sender.get("hash", ""))) \
                            or type(item.get("index")) is not int or item["index"] < 0:
                        continue
                    matching.append({"from": sender["hash"].lower(), "to": safe_address.lower(),
                                     "valueWei": value_wei, "transferType": "internal_call",
                                     "internalTransactionIndex": item["index"],
                                     "blockNumber": block_number})
        if len(matching) != 1:
            raise ValueError("transaction data does not establish one matching successful Safe transfer")
        results.append({"transactionHash": tx_hash, "status": "success",
                        "blockNumber": block_number, "blockHash": block_hash.lower(),
                        "amountEth": row["amountEth"], "valueWei": matching[0]["valueWei"],
                        "from": matching[0]["from"], "to": matching[0]["to"],
                        "transferType": matching[0]["transferType"],
                        "internalTransactionIndex": matching[0]["internalTransactionIndex"], "chainId": 1})
    return {"safeAddress": safe_address.lower(), "chainId": 1,
            "reportedTotalEth": table["totalEth"],
            "transactions": results,
            "exactTotalWei": str(sum(int(row["valueWei"]) for row in results))}


def validate_returned_funds_data(data, table, safe_address):
    if not isinstance(data, dict) or data.get("chainId") != 1 or data.get("safeAddress") != safe_address.lower():
        return ""
    transactions = data.get("transactions")
    if not isinstance(transactions, list) or len(transactions) != len(table["rows"]):
        return ""
    exact_total = 0
    for index, (observed, expected) in enumerate(zip(transactions, table["rows"])):
        if not isinstance(observed, dict) or observed.get("transactionHash") != expected["transactionHash"] \
                or observed.get("status") != "success" or observed.get("amountEth") != expected["amountEth"] \
                or observed.get("to") != safe_address.lower() \
                or not re.fullmatch(r"0x[0-9a-f]{64}", observed.get("blockHash", "")) \
                or type(observed.get("blockNumber")) is not int or observed["blockNumber"] < 1 \
                or not SAFE_ADDRESS.fullmatch(observed.get("from", "")) \
                or not re.fullmatch(r"\d{1,78}", observed.get("valueWei", "")):
            return ""
        if observed.get("chainId") != 1:
            return ""
        if observed.get("transferType") == "transaction_value":
            if observed.get("internalTransactionIndex") is not None:
                return ""
        elif observed.get("transferType") == "internal_call":
            if type(observed.get("internalTransactionIndex")) is not int or observed["internalTransactionIndex"] < 0:
                return ""
        else:
            return ""
        amount_parts = expected["amountEth"].split(".")
        expected_micro = int(amount_parts[0]) * 1000000 + int((amount_parts[1] if len(amount_parts) > 1 else "").ljust(6, "0"))
        value_wei = int(observed["valueWei"])
        if value_wei // (10 ** 12) != expected_micro:
            return ""
        exact_total += value_wei
    if str(exact_total) != data.get("exactTotalWei") or data.get("reportedTotalEth") != table["totalEth"]:
        return ""
    return str(exact_total)


def split_passages(material):
    source = json.loads(material)
    # Titles name proposals but frequently use action nouns (e.g. "Grants
    # program"); only body and voting-choice material drive action extraction.
    content = "\n".join([source.get("body", "")] + source.get("choices", []))
    passages = [line.strip() for line in content.splitlines() if line.strip()]
    if len(passages) > 120:
        raise ValueError("proposal exceeds reviewed passage limit")
    return passages


def plain_text(line):
    text = re.sub(r"^\s{0,3}(?:#{1,6}\s*|[-*+]\s+|\d+[.)]\s+)", "", line)
    text = re.sub(r"[`*_]", "", text)
    return re.sub(r"\s+", " ", text).strip()


def negates_action(text):
    return bool(re.search(
        r"\b(?:does not|doesn't|did not|will not|shall not|no longer|not)\b.{0,70}"
        r"\b(?:change|replace|remove|add|transfer|send|allocate|grant|appoint|rotate)\b", text, re.I,
    ))


def classify_action(line):
    """Accept only explicit, bounded execution language; headings and mentions are not actions."""
    text = plain_text(line)
    if not text or re.fullmatch(r"(?:proposed change|proposed action|execution|actions?)\s*:?s*", text, re.I):
        return None

    distribution = DISTRIBUTION_ACTION.fullmatch(text)
    if distribution:
        return {"kind": "treasury_distribution", "sourceExcerpt": line[:240],
                "summary": line[:220], "actor": "", "target": distribution.group(2).strip(" .;,:"),
                "amount": "", "asset": "", "method": ""}

    transfer = TREASURY_ACTION.search(text)
    if transfer and not negates_action(text):
        amount = TRANSFER_AMOUNT.search(text[transfer.end():transfer.end() + 120])
        if amount:
            recipient = re.search(r"\bto\s+([^.;\n]{1,100})", text[transfer.end() + amount.end():], re.I)
            target = ""
            if recipient:
                target_text = recipient.group(1).strip(" ,:-")
                address = SAFE_ADDRESS.search(target_text)
                target = address.group(0) if address else target_text[:100]
            actor_match = re.search(r"\bfrom\s+(?:the\s+)?([^.;,]{1,80})", text[:transfer.start()], re.I)
            return {
                "kind": "treasury_transfer", "sourceExcerpt": line[:240],
                "summary": line[:220], "actor": actor_match.group(1).strip() if actor_match else "",
                "target": target, "amount": amount.group("amount").strip(),
                "asset": amount.group("asset").upper(), "method": "",
            }

    method = CONTROL_CALL.search(text)
    if method and re.search(r"\b(?:execution|call|execute|proposed|will|shall|single)\b", text[:method.start()] + text[method.end():], re.I):
        if not negates_action(text):
            safe_label = re.search(r"\bon\s+(?:the\s+)?([A-Z][A-Za-z0-9 '&-]{0,70}\bSafe)\b", text)
            target = safe_label.group(1).strip() if safe_label else ""
            return {
                "kind": "control_change", "sourceExcerpt": line[:240],
                "summary": line[:220], "actor": "", "target": target,
                "amount": "", "asset": "", "method": method.group(0),
            }

    if not negates_action(text) and CONTROL_CHANGE.search(text):
        return {"kind": "control_change", "sourceExcerpt": line[:240], "summary": line[:220],
                "actor": "", "target": "", "amount": "", "asset": "", "method": ""}

    operator = re.search(r"\b(?:a|the)\s+program operator\b", text, re.I)
    reviewer = re.search(r"\b(?:a|the)\s+milestone reviewer\b", text, re.I)
    operational_verb = re.search(r"\b(?:requests?|distributes?|releases?|approves?)\b", text, re.I)
    if operator and operational_verb and re.search(r"\b(?:tranches?|milestones?|each release)\b", text, re.I):
        return {"kind": "execution_dependency", "sourceExcerpt": line[:240], "summary": line[:220],
                "actor": operator.group(0), "target": "", "amount": "", "asset": "", "method": "",
                "humanDependencies": [operator.group(0)] + ([reviewer.group(0)] if reviewer else []),
                "dependency": "Milestone reviewer approval is described for each release." if reviewer else ""}
    return None


def derive_record_facts(material, safe_data, safe_adapter_state="not_attempted",
                        returned_funds=None, returned_funds_state="not_attempted", safe_failure_code=""):
    """Deterministic extraction; validators re-run this and compare all fields."""
    passages = split_passages(material)
    actions = []
    claims = []
    safeguards = []
    execution_plan = []
    return_table = extract_return_table(material)
    seen_external_claims = set()
    safe_address = safe_data["address"] if safe_data else ""
    in_execution_plan = False
    for line in passages:
        text = plain_text(line)
        if re.search(r"\bif\s+this\s+proposal\s+passes\b.{0,100}\bfollowing\s+actions\s+will\s+be\s+executed\b", text, re.I):
            in_execution_plan = True
            continue
        if in_execution_plan and line.lstrip().startswith("#"):
            in_execution_plan = False
        if in_execution_plan and len(execution_plan) < 6 and re.match(
                r"^\s{0,3}\d+[.)]\s+(?:\*{0,2})?(?:publish|deploy|open|monitor|support|transfer|send|allocate|fund|disburse|grant|execute|call)\b",
                line, re.I):
            actor_match = re.search(
                r"\b(the\s+[A-Z][A-Za-z0-9 '&-]{2,90}?)\s+(?:are\s+mandated|will|shall)\s+(?:to\s+)?(?:develop|deploy|publish|open|monitor|support)\b",
                text,
            )
            execution_plan.append({"sourceExcerpt": line[:240], "actor": actor_match.group(1) if actor_match else ""})
        action = classify_action(line)
        if action and action["kind"] == "treasury_distribution":
            if re.search(r"\bLPs?\s+receive\s+ETH\b", "\n".join(passages), re.I):
                action["asset"] = "ETH"
            if re.search(r"\bclaim(?:ing)?\s+mechanism\b.{0,100}\bdevelop(?:ed|ment)?\b", "\n".join(passages), re.I):
                action["dependency"] = "A claiming mechanism is described as requiring development."
            implementer = re.search(
                r"\b(the\s+Balancer\s+Foundation\s+and\s+Service\s+Providers)\s+are\s+mandated\s+to\s+develop\s+and\s+deploy\s+the\s+claim\s+framework\b",
                "\n".join(passages), re.I,
            )
            action["humanDependencies"] = [implementer.group(1)] if implementer else []
        if action and len(actions) < 6:
            actions.append(action)
            claims.append({"claim": action["summary"], "sourceExcerpt": line[:280], "counterExcerpt": "",
                           "claimScope": "proposal_action", "status": "supported",
                           "explanation": "This is an action stated in the proposal; it does not establish that the action was executed.",
                           "evidence": ["proposal"], "confidence": "high", "verificationMethod": "proposal_presence_only"})

        is_safe_threshold = bool(SAFE_THRESHOLD.search(text) and "safe" in text.lower())
        is_external_claim = bool(METRIC_CLAIM.search(text)) and not action
        if (is_external_claim or is_safe_threshold) and len(claims) < 8:
            threshold_match = SAFE_THRESHOLD.search(text)
            address_match = SAFE_CONTRACT_ADDRESS.search(text)
            member_match = re.search(r"\b(\d{1,3})\s+members?\b", text, re.I)
            if threshold_match and (member_match or "threshold" in text.lower()):
                safe_ref = address_match.group(1).lower() if address_match else ""
                member_ref = member_match.group(1) if member_match else ""
                claim_key = "safe-configuration:" + safe_ref + ":" + threshold_match.group(1) + "/" + threshold_match.group(2) + ":" + member_ref
            else:
                claim_key = re.sub(r"[^a-z0-9]+", "", text.lower())
            if claim_key in seen_external_claims:
                continue
            seen_external_claims.add(claim_key)
            safe_claim = bool(threshold_match and address_match)
            status = "unverified"
            explanation = ("The Safe on-chain state adapter could not retrieve or validate both RPC responses; this claim remains unverified."
                           if safe_adapter_state == "unavailable" else "No independent evidence adapter applies to this claim.")
            evidence = ["proposal"]
            if safe_claim and safe_data and address_match.group(1).lower() == safe_address:
                claimed = (int(threshold_match.group(1)), int(threshold_match.group(2)))
                actual = (safe_data["threshold"], len(safe_data["owners"]))
                status = "supported" if claimed == actual else "contradicted"
                explanation = ("The proposal's stated Safe threshold was compared with getThreshold() and getOwners() at Ethereum block "
                               + str(safe_data["blockNumber"]) + "; two fixed RPC providers returned matching state. Provider responses are not cryptographic proofs.")
                evidence = ["proposal", "safe-rpc-publicnode", "safe-rpc-drpc"]
            counter_excerpt = ""
            verification_method = ""
            if safe_claim and safe_data and address_match.group(1).lower() == safe_address:
                counter_excerpt = (str(safe_data["threshold"]) + "/" + str(len(safe_data["owners"]))
                                   + " threshold and owners reported by two Ethereum RPC providers at block "
                                   + str(safe_data["blockNumber"]))
                verification_method = "ethereum_mainnet_dual_rpc_safe_config_comparison_v1"
            claims.append({"claim": text[:280], "sourceExcerpt": line[:280], "counterExcerpt": counter_excerpt,
                           "claimScope": "external_factual", "status": status,
                           "explanation": explanation, "evidence": evidence,
                           "confidence": "medium" if status in ("supported", "contradicted") else "low",
                           "verificationMethod": verification_method})
        if re.search(r"\b(multisig|threshold|milestone|clawback|refund|recover|recovery|oversight|reviewer|timelock|escrow)\b", text, re.I) and len(safeguards) < 8:
            linked_actions = ["a" + str(index + 1) for index, action in enumerate(actions)
                              if (action["target"] and action["target"].lower() in text.lower())
                              or action["sourceExcerpt"] == line[:240]]
            kind = "multisig" if re.search(r"multisig|threshold", text, re.I) else "milestone" if re.search(r"milestone", text, re.I) else "recovery" if re.search(r"clawback|refund|recover|recovery|escrow", text, re.I) else "oversight"
            safeguards.append({"sourceExcerpt": line[:240], "kind": kind, "relatedActionIds": linked_actions})

    if return_table:
        return_ids = ["return-tx-" + str(index + 1) for index in range(len(return_table["rows"]))]
        exact_total = validate_returned_funds_data(returned_funds, return_table, safe_address) if safe_address else ""
        verified = bool(exact_total)
        if not verified:
            returned_funds = None
            returned_funds_state = "unavailable"
        if verified:
            exact_total_wei = int(exact_total)
            whole = exact_total_wei // 10**18
            fraction = str(exact_total_wei % 10**18).rjust(18, "0").rstrip("0")
            exact_total_eth = str(whole) + ("." + fraction if fraction else "")
            explanation = ("Validators independently retrieved Blockscout's Ethereum-mainnet transaction and block records for every listed hash "
                           "and its internal-transaction record where needed. The provider reported successful execution and a transfer to the "
                           "proposal-identified Safe matching each table amount at six-decimal precision.")
            counter_excerpt = "Blockscout-reported transfers total " + exact_total_eth + " ETH; the proposal displays " + return_table["totalEth"] + " ETH."
            claim_evidence = ["proposal"] + return_ids
            verification_method = "blockscout_mainnet_transfer_amount_comparison"
            confidence = "high"
        else:
            explanation = "The proposal lists returned-fund transactions, but bounded validator-side provider verification did not complete; the amount remains unverified."
            counter_excerpt = ""
            claim_evidence = ["proposal"]
            verification_method = ""
            confidence = "low"
        claims.append({"claim": "The proposal reports " + return_table["totalEth"] + " ETH returned to the DAO Safe in " + str(len(return_table["rows"])) + " transactions.",
                       "sourceExcerpt": return_table["totalExcerpt"], "counterExcerpt": counter_excerpt,
                       "claimScope": "external_factual", "status": "supported" if verified else "unverified",
                       "explanation": explanation, "evidence": claim_evidence, "confidence": confidence,
                       "verificationMethod": verification_method})

    for safeguard in safeguards:
        safeguard["relatedActionIds"] = ["a" + str(index + 1) for index, action in enumerate(actions)
                                         if (action["target"] and action["target"].lower() in safeguard["sourceExcerpt"].lower())
                                         or action["sourceExcerpt"] == safeguard["sourceExcerpt"]
                                         or len(actions) == 1]

    safeguard_gaps = []
    expected = []
    if any(item["kind"] == "treasury_transfer" for item in actions):
        expected = [("recovery", r"clawback|refund|recover|return|unused funds"),
                    ("independent_verification", r"independent.{0,40}(verif|review|audit)|third.party")]
    full_text = "\n".join(passages)
    transfer_actions = [(index, action) for index, action in enumerate(actions) if action["kind"] == "treasury_transfer"]
    for action_index, action in enumerate(actions):
      if action["kind"] != "treasury_transfer":
        continue
      for name, pattern in expected:
        scoped = [line for line in passages if (action["sourceExcerpt"] == line[:240])
                  or (action["target"] and action["target"].lower() in line.lower())]
        scope_text = full_text if len(transfer_actions) == 1 else "\n".join(scoped)
        if len(transfer_actions) > 1 and not scoped:
            state = "unknown"
            scope = "safeguard could not be attributed to this specific action"
        elif (re.search(r"\b(?:no|without|lacks?|absent)\b.{0,60}" + pattern, scope_text, re.I)
              or re.search(pattern + r".{0,60}\b(?:does not exist|do not exist|will not apply|is not provided|is not available|is absent)\b", scope_text, re.I)):
            state = "explicitly_absent"
            scope = "complete validator-retrieved proposal material" if len(transfer_actions) == 1 else "material linked to action"
        elif re.search(pattern, scope_text, re.I):
            state = "present"
            scope = "complete validator-retrieved proposal material" if len(transfer_actions) == 1 else "material linked to action"
        else:
            state = "not_identified"
            scope = "complete validator-retrieved proposal material" if len(transfer_actions) == 1 else "material linked to action"
        safeguard_gaps.append({"safeguard": name, "state": state, "scope": scope,
                               "relatedActionIds": ["a" + str(action_index + 1)], "evidence": ["proposal"]})

    return {"actions": actions, "claims": claims, "safeguards": safeguards,
            "safeguardGaps": safeguard_gaps, "safe": safe_data,
            "safeAdapterState": safe_adapter_state, "safeFailureCode": safe_failure_code,
            "executionPlan": execution_plan,
            "returnedFunds": returned_funds, "returnedFundsState": returned_funds_state}


def summarize_action(action, incoming_signer):
    if action["kind"] == "control_change" and action["method"] and "swapowner" in action["method"].lower():
        nominee = " for " + incoming_signer.group(1) if incoming_signer else ""
        return "Replace a Safe signer" + nominee + " through the stated swapOwner() call."
    return plain_text(action["sourceExcerpt"])[:220]


def build_report(facts, material, source, assessment_run_id):
    source_hash = digest(material)
    proposal = json.loads(material)
    evidence = [{"id": "proposal", "type": "proposal", "locator": "https://snapshot.box/#/s:" + source["space"] + "/proposal/" + source["proposalId"],
                 "description": "Validator-retrieved Snapshot proposal", "contentHash": source_hash,
                 "verificationScope": "validator_retrieved_proposal", "authority": "primary"}]
    if facts["safe"]:
        for provider_name, provider_url in ETHEREUM_RPC_PROVIDERS:
            provider_data = {"provider": provider_name, "address": facts["safe"]["address"],
                             "chainId": facts["safe"]["chainId"], "blockNumber": facts["safe"]["blockNumber"],
                             "blockHash": facts["safe"]["blockHash"], "threshold": facts["safe"]["threshold"],
                             "owners": facts["safe"]["owners"]}
            evidence.append({"id": "safe-rpc-" + provider_name, "type": "safe_onchain", "locator": provider_url,
                             "description": "Safe contract state returned by " + provider_name + " Ethereum JSON-RPC at the pinned block",
                             "contentHash": digest(canonical(provider_data)),
                             "verificationScope": "validator_retrieved_external_source",
                             "authority": "secondary", "structuredData": provider_data})
    returned_evidence_ids = []
    if facts.get("returnedFundsState") == "retrieved" and facts.get("returnedFunds"):
        for index, item in enumerate(facts["returnedFunds"]["transactions"]):
            evidence_id = "return-tx-" + str(index + 1)
            returned_evidence_ids.append(evidence_id)
            evidence.append({"id": evidence_id, "type": "onchain",
                             "locator": BLOCKSCOUT_TX_PAGE + item["transactionHash"],
                             "description": "Blockscout-indexed Ethereum mainnet returned-fund transaction " + str(index + 1),
                             "contentHash": digest(canonical(item)),
                             "verificationScope": "validator_retrieved_external_source",
                             "authority": "secondary", "structuredData": item})

    findings = []
    execution = []
    questions = []
    full_text = "\n".join(split_passages(material))
    incoming_signer = re.search(r"(@[A-Za-z0-9_.-]+).{0,60}\b(?:new|incoming)\s+signer\b", full_text, re.I)
    for index, action in enumerate(facts["actions"]):
        fid = "f" + str(index + 1)
        transfer = action["kind"] == "treasury_transfer"
        distribution = action["kind"] == "treasury_distribution"
        control_change = action["kind"] == "control_change"
        program_step = action["kind"] == "execution_dependency"
        action_id = "a" + str(index + 1)
        safeguards = []
        for item in facts["safeguards"]:
            if action_id not in item["relatedActionIds"]:
                continue
            source_text = plain_text(item["sourceExcerpt"])
            if item["kind"] == "multisig":
                safeguards.append("Proposal states: " + source_text[:180] + ". Current configuration was not independently verified.")
            else:
                safeguards.append(source_text[:220])
        related_gaps = [item for item in facts["safeguardGaps"] if action_id in item["relatedActionIds"]]
        target_is_safe = bool(action["target"] and facts["safe"] and action["target"].lower() == facts["safe"]["address"])
        human_dependencies = list(action.get("humanDependencies", []))
        if control_change and incoming_signer:
            human_dependencies.append("Proposed incoming signer: " + incoming_signer.group(1))
        if target_is_safe:
            human_dependencies.extend(["Safe owner " + owner for owner in facts["safe"]["owners"]])
        human_dependencies = human_dependencies[:20]
        technical_dependencies = []
        if target_is_safe:
            technical_dependencies.append("Safe contract " + facts["safe"]["address"])
        elif control_change and action["method"]:
            target_label = action["target"] or "Safe address not identified"
            technical_dependencies.append(target_label + " " + action["method"])
        if program_step:
            technical_dependencies = []
        dependency_match = re.search(r"\b(?:subject to|requires?|depends? on|after|once)\b\s+(.{1,120})", action["sourceExcerpt"], re.I)
        dependency = action.get("dependency", "") or (dependency_match.group(1).strip(" .;,") if dependency_match else "")
        if transfer:
            summary = summarize_action(action, incoming_signer)
            impact = ("The proposal requests moving " + action["amount"] + " " + action["asset"]
                      + (" to " + action["target"] if action["target"] else " to a recipient not identified in this passage")
                      + "; the reviewed material does not establish later custody or recovery.")
            why = "After execution, control of transferred assets depends on the identified recipient and any stated recovery path."
            title = "Treasury transfer; recipient or recovery requires review"
            finding_type = "treasury_exposure"
            severity = "high"
        elif control_change:
            summary = summarize_action(action, incoming_signer)
            safe_control = bool(action["method"] or re.search(
                r"\b(?:safe|multisig|signer|owner)\b", action["sourceExcerpt"], re.I,
            ))
            if safe_control:
                impact = "If executed, the stated operation changes the Safe owner or signer control path. The proposal does not identify an on-chain Safe address in the reviewed material." if not facts["safe"] else "If executed, the stated operation changes the Safe owner or signer control path."
                why = "A Safe owner change affects which signers can participate in transaction approvals."
                title = "Safe signer control change"
            else:
                impact = "If executed, the stated governance control or rule changes as described in the proposal."
                why = "A governance control or rule change affects how the proposal's identified governance process operates."
                title = "Governance control or rule change"
            finding_type = "governance_change"
            severity = "medium"
            if safe_control and not any(re.search(r"0x[0-9a-f]{40}", item, re.I) for item in technical_dependencies):
                questions.append({"id": "q" + str(len(questions) + 1),
                                  "question": "Which Safe address will execute the stated owner change?",
                                  "whyItMatters": "Without the contract address, its current owners and threshold cannot be independently checked.",
                                  "relatedFindingIds": [fid], "evidenceGap": "Safe address not identified in reviewed proposal material."})
            if safe_control and "swapowner" in action["method"].lower() and "resign" in full_text.lower():
                questions.append({"id": "q" + str(len(questions) + 1),
                                  "question": "Which current Safe owner address corresponds to the resigning signer?",
                                  "whyItMatters": "The proposal names the role change but the current owner address is not established in reviewed material.",
                                  "relatedFindingIds": [fid], "evidenceGap": "Current signer address not identified."})
        elif distribution:
            summary = "Distribute funds to " + action["target"] + "."
            if action["asset"]:
                summary = "Distribute " + action["asset"] + " to " + action["target"] + "."
            impact = "The proposal requests a distribution to " + action["target"] + "; only the execution details stated in the reviewed material are established."
            why = "Control and delivery depend on the distribution process identified by the proposal."
            title = "Proposed treasury distribution"
            finding_type = "treasury_exposure"
            severity = "medium"
            if action.get("dependency"):
                technical_dependencies.append(action["dependency"])
                questions.append({"id": "q" + str(len(questions) + 1),
                                  "question": "Which implementation and control configuration will satisfy the stated distribution dependency?",
                                  "whyItMatters": "The proposal states a technical dependency but does not establish its deployed implementation.",
                                  "relatedFindingIds": [fid], "evidenceGap": action["dependency"]})
        else:
            summary = summarize_action(action, incoming_signer)
            if dependency:
                impact = "The described release process depends on the named operator and the stated dependency: " + dependency
                why = "The proposal makes the identified dependency part of the release process."
                title = "Stated approval is an execution dependency"
            else:
                impact = "The proposal assigns the described release activity to the named operator; no separate approval dependency was established."
                why = "The execution described by the proposal depends on the named operator acting."
                title = "Program operator is an execution dependency"
            finding_type = "execution_dependency"
            severity = "medium"
        finding_evidence = ["proposal", "safe-rpc-publicnode", "safe-rpc-drpc"] if facts["safe"] and target_is_safe else ["proposal"]
        findings.append({"id": fid, "type": finding_type, "title": title,
                         "observation": summary, "sourceExcerpt": action["sourceExcerpt"],
                         "whyItMatters": why, "impact": impact,
                         "severity": severity, "confidence": "medium",
                         "evidence": finding_evidence, "existingSafeguards": safeguards,
                         "safeguardGaps": related_gaps,
                         "humanDependencies": human_dependencies,
                         "technicalDependencies": technical_dependencies,
                         "reversible": "unknown", "uncertainty": "Only explicitly evidenced execution details are included.",
                         "relatedActionIds": [action_id],
                         "consensus": {"state": "accepted", "method": "independent_structured_derivation_v3_3"}})
        execution.append({"id": "s" + str(index + 1), "order": index + 1,
                          "action": summary, "actor": action["actor"], "target": action["target"],
                          "asset": action["asset"], "amount": action["amount"],
                          "dependency": dependency, "impact": impact, "humanDependencies": human_dependencies,
                          "technicalDependencies": technical_dependencies,
                          "reversible": "unknown", "evidence": finding_evidence,
                          "relatedActionIds": [action_id]})
        if transfer and action["target"]:
            questions.append({"id": "q" + str(len(questions) + 1),
                              "question": "What execution path follows the initial transfer to " + action["target"] + "?",
                              "whyItMatters": "The reviewed proposal excerpt does not establish later custody or recovery steps.",
                              "relatedFindingIds": [fid], "evidenceGap": "Later execution path not established from reviewed evidence."})
        reviewer_identified = any(action_id in item["relatedActionIds"]
                                  and re.search(r"\b(reviewer|reviewers|approver|approvers|committee|council|independent verifier)\b", item["sourceExcerpt"], re.I)
                                  for item in facts["safeguards"])
        if transfer and not reviewer_identified and len(questions) < 6:
            questions.append({"id": "q" + str(len(questions) + 1), "question": "Who independently verifies use of transferred funds?",
                              "whyItMatters": "Disbursement may depend on a human review process.",
                              "relatedFindingIds": [fid], "evidenceGap": "Reviewer not identified in reviewed proposal material."})

    for plan_index, plan_step in enumerate(facts["executionPlan"]):
        action = plain_text(plan_step["sourceExcerpt"])
        target = ""
        impact = "The proposal states this execution step: " + action[:180]
        technical = []
        human = [plan_step["actor"]] if plan_step["actor"] else []
        order = len(execution) + 1
        execution.append({"id": "s" + str(order), "order": order, "action": action,
                          "actor": plan_step["actor"], "target": target, "asset": "", "amount": "",
                          "dependency": "", "impact": impact, "humanDependencies": human,
                          "technicalDependencies": technical, "reversible": "unknown", "evidence": ["proposal"]})

    for item in facts["safeguardGaps"]:
        if item["state"] in ("not_identified", "explicitly_absent") and len(questions) < 6:
            questions.append({"id": "q" + str(len(questions) + 1),
                              "question": "What is the " + item["safeguard"] + " arrangement?",
                              "whyItMatters": "The proposal evidence records this safeguard state as " + item["state"].replace("_", " ") + ".",
                              "relatedFindingIds": ["f" + action_id[1:] for action_id in item["relatedActionIds"]], "evidenceGap": item["scope"]})

    if not facts["actions"] and not facts["executionPlan"] and len(questions) < 6:
        questions.append({"id": "q" + str(len(questions) + 1),
                          "question": "What concrete action is this proposal requesting?",
                          "whyItMatters": "No bounded execution action could be established by the current extraction rules.",
                          "relatedFindingIds": [], "evidenceGap": "Action not established; review the original proposal."})
    questions = questions[:6]
    contradicted = any(item["claimScope"] == "external_factual" and item["status"] == "contradicted" for item in facts["claims"])
    priority = "urgent" if any(f["severity"] == "critical" for f in findings) else "high" if any(f["severity"] == "high" for f in findings) or contradicted else "normal" if findings or questions else "low"
    priority_reasons = []
    if any(item["kind"] == "treasury_transfer" for item in facts["actions"]):
        priority_reasons.append("a treasury transfer is proposed")
    elif any(item["kind"] == "treasury_distribution" for item in facts["actions"]):
        priority_reasons.append("a treasury distribution is proposed")
    if any(item["kind"] == "control_change" for item in facts["actions"]):
        priority_reasons.append("a Safe or governance control change is proposed")
    if contradicted:
        priority_reasons.append("a material external claim conflicts with retrieved evidence")
    if questions:
        priority_reasons.append("material execution details remain unresolved")
    reason = (priority.capitalize() + " review priority because " + "; ".join(priority_reasons[:3]) + ". This is a human-attention cue, not a voting recommendation.") if priority_reasons else "Low review priority: no structured material issue was identified in the reviewed evidence; inspect the original proposal for context."
    purpose = plain_text(proposal.get("title", ""))[:400]
    action_summaries = [summarize_action(item, incoming_signer) for item in facts["actions"]]
    claims = []
    for index, claim in enumerate(facts["claims"]):
        claims.append({"id": "c" + str(index + 1), **claim})
    material_actions = []
    for index, action in enumerate(facts["actions"]):
        material_actions.append({"id": "a" + str(index + 1), **action})
    record = {"assessmentVersion": "3", "assessmentSchemaVersion": "3.3",
              "assessmentRunId": assessment_run_id,
              "proposalKey": "snapshot:" + source["space"] + ":" + source["proposalId"],
              "contentHash": source_hash, "sourceLocatorHash": digest(canonical(source)),
              "overview": {"purpose": purpose or "Purpose not established from the proposal title.",
                           "requestedActions": action_summaries,
                           "assetsAffected": [x["amount"] + " " + x["asset"] for x in facts["actions"] if x["asset"]],
                           "permissionsChanged": [], "controlChanges": [action_summaries[index] for index, item in enumerate(facts["actions"]) if item["kind"] == "control_change"]},
              "evidence": evidence, "externalEvidenceState": facts["safeAdapterState"],
              "externalEvidenceFailureCode": facts.get("safeFailureCode", ""),
              "returnedFundsState": facts.get("returnedFundsState", "not_attempted"),
              "materialActions": material_actions, "materialClaims": claims, "findings": findings,
              "safeguardGaps": facts["safeguardGaps"], "executionMap": execution,
              "unresolvedQuestions": questions, "reviewPriority": priority,
              "reviewPriorityExplanation": reason, "assessedAt": gl.message_raw["datetime"],
              "provenance": "live", "consensus": {"state": "accepted", "method": "independent_structured_derivation_v3_3"}}
    if len(canonical(record).encode("utf-8")) > MAX_RECORD_BYTES:
        raise ValueError("v3 record exceeds storage limit")
    return record


class GovernanceDueDiligenceV33(gl.Contract):
    owner: str
    operator: str
    allowed_spaces: TreeMap[str, str]
    assessments: TreeMap[str, str]
    latest: TreeMap[str, str]
    latest_by_schema: TreeMap[str, str]
    revision_latest: TreeMap[str, str]
    run_records: TreeMap[str, str]
    run_proposals: TreeMap[str, str]

    def __init__(self, operator: str, allowed_spaces_json: str):
        spaces = json.loads(allowed_spaces_json)
        if not isinstance(spaces, list) or not 1 <= len(spaces) <= 8 or len(set(spaces)) != len(spaces):
            raise gl.vm.UserError("invalid Snapshot space allowlist")
        checked_operator = bounded(operator, "operator", 42)
        if (not re.fullmatch(r"0x[0-9a-fA-F]{40}", checked_operator)
                or checked_operator.lower() == "0x" + "0" * 40):
            raise gl.vm.UserError("invalid operator address")
        self.owner = str(gl.message.sender_address).lower()
        self.operator = checked_operator.lower()
        self.allowed_spaces = TreeMap[str, str]()
        for space in spaces:
            checked = bounded(space, "space", 128)
            if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", checked):
                raise gl.vm.UserError("invalid Snapshot space allowlist")
            self.allowed_spaces[checked] = "allowed"
        self.assessments = TreeMap[str, str]()
        self.latest = TreeMap[str, str]()
        self.latest_by_schema = TreeMap[str, str]()
        self.revision_latest = TreeMap[str, str]()
        self.run_records = TreeMap[str, str]()
        self.run_proposals = TreeMap[str, str]()

    def _require_owner(self):
        if str(gl.message.sender_address).lower() != self.owner:
            raise gl.vm.UserError("only owner may change contract authority")

    @gl.public.write
    def set_operator(self, operator: str) -> None:
        self._require_owner()
        checked = bounded(operator, "operator", 42)
        if (not re.fullmatch(r"0x[0-9a-fA-F]{40}", checked)
                or checked.lower() == "0x" + "0" * 40):
            raise gl.vm.UserError("invalid operator address")
        self.operator = checked.lower()

    @gl.public.write
    def set_snapshot_space_allowed(self, space: str, allowed: bool) -> None:
        self._require_owner()
        checked = bounded(space, "space", 128)
        if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", checked):
            raise gl.vm.UserError("invalid Snapshot space")
        self.allowed_spaces[checked] = "allowed" if allowed else "blocked"

    @gl.public.view
    def get_contract_schema(self) -> str:
        return canonical({"assessmentVersion": "3", "assessmentSchemaVersion": "3.3",
                          "consensusMethod": "independent_structured_derivation_v3_3"})

    @gl.public.view
    def get_assessment(self, proposal_key: str) -> str:
        return self.assessments.get(self.latest.get(proposal_key, ""), "")

    @gl.public.view
    def get_assessment_by_run(self, assessment_run_id: str) -> str:
        return self.assessments.get(self.run_records.get(assessment_run_id, ""), "")

    @gl.public.view
    def get_assessment_for_schema(self, proposal_key: str, schema_version: str) -> str:
        if schema_version != "3.3":
            return ""
        record_key = self.latest_by_schema.get(proposal_key + ":" + schema_version, "")
        return self.assessments.get(record_key, "")

    @gl.public.view
    def get_assessment_for_revision(self, proposal_key: str, content_hash: str) -> str:
        if not isinstance(content_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", content_hash):
            raise gl.vm.UserError("invalid content hash")
        record_key = self.revision_latest.get(proposal_key + ":" + content_hash, "")
        return self.assessments.get(record_key, "")

    @gl.public.write
    def assess(self, source_json: str, assessment_run_id: str) -> str:
        if str(gl.message.sender_address).lower() != self.operator:
            raise gl.vm.UserError("only configured operator may create assessments")
        source = source_for(source_json)
        if self.allowed_spaces.get(source["space"], "") != "allowed":
            raise gl.vm.UserError("Snapshot space is not allowlisted")
        key = "snapshot:" + source["space"] + ":" + source["proposalId"]
        run_id = bounded(assessment_run_id, "assessment run ID", 128)
        previous = self.run_records.get(run_id, "")
        if previous:
            if self.run_proposals.get(run_id, "") != key:
                raise gl.vm.UserError("assessment run ID used for another proposal")
            return self.assessments.get(previous, "")

        source_text = canonical(source)

        def fetch_agreed_material():
            return fetch_proposal(json.loads(source_text))

        material = gl.eq_principle.strict_eq(fetch_agreed_material)
        passages = split_passages(material)
        safe_candidate = safe_candidate_from_material(material)

        def derive(block_pin=None):
            safe_data = None
            safe_state = "not_attempted"
            safe_failure_code = ""
            if safe_candidate:
                try:
                    safe_data = fetch_safe_onchain(safe_candidate, block_pin)
                    safe_state = "retrieved"
                except Exception as error:
                    # A failed/invalid adapter is not evidence against the
                    # proposal. Validators still compare that this source was
                    # unavailable on their own retrieval attempt. Publish only
                    # an allowlisted reason code, never a URL/body/exception.
                    safe_state = "unavailable"
                    message = str(error)
                    safe_failure_code = message if re.fullmatch(r"rpc_[a-z0-9_]{1,48}", message) else "rpc_adapter_error"
            returned_funds = None
            returned_state = "not_attempted"
            try:
                return_table = extract_return_table(material)
                if return_table:
                    if not safe_candidate or not safe_data:
                        returned_state = "unavailable"
                    else:
                        try:
                            returned_funds = fetch_returned_funds(return_table, safe_candidate)
                            returned_state = "retrieved"
                        except Exception:
                            returned_state = "unavailable"
            except Exception:
                returned_state = "unavailable"
            return derive_record_facts(material, safe_data, safe_state, returned_funds, returned_state, safe_failure_code)

        def validate(leader_result):
            if not isinstance(leader_result, gl.vm.Return):
                return False
            try:
                leader_facts = leader_result.calldata
                if not isinstance(leader_facts, dict):
                    return False
                leader_safe = leader_facts.get("safe")
                block_pin = ({"blockNumber": leader_safe.get("blockNumber"), "blockHash": leader_safe.get("blockHash")}
                             if isinstance(leader_safe, dict) else None)
                validator_facts = derive(block_pin)
                return canonical(validator_facts) == canonical(leader_result.calldata)
            except Exception:
                return False

        facts = gl.vm.run_nondet_unsafe(derive, validate)
        record = build_report(facts, material, source, run_id)
        record["proposalKey"] = key
        record_key = "run:" + run_id
        stored = canonical(record)
        self.assessments[record_key] = stored
        self.latest[key] = record_key
        self.latest_by_schema[key + ":3.3"] = record_key
        self.revision_latest[key + ":" + record["contentHash"]] = record_key
        self.run_records[run_id] = record_key
        self.run_proposals[run_id] = key
        return stored
