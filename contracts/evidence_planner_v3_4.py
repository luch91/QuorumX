# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
"""Deterministic, bounded evidence planning for grounded Decision IR records.

This module plans *which existing bounded adapter may be relevant*.  It does
not retrieve proposal-provided URLs and it does not turn a planned item into
evidence.  The only new execution-artifact shape is a fixed GitHub pull
request allowlist; its materializer returns contextual evidence, never proof
that the proposed execution occurred.
"""

from genlayer import *
import hashlib
import json
import re


MAX_MATERIAL_BYTES = 24_000
MAX_PLAN_ITEMS = 12
MAX_GITHUB_RESPONSE_BYTES = 64_000
MAX_GITHUB_BODY = 32_000
SNAPSHOT_SOURCE = re.compile(r"^[a-z0-9][a-z0-9.-]{0,127}$")
SNAPSHOT_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
ADDRESS = re.compile(r"^0x[0-9a-fA-F]{40}$")
TX_HASH_IN_MATERIAL = re.compile(r"(?<![0-9a-fA-F])0x[0-9a-fA-F]{64}(?![0-9a-fA-F])")
GITHUB_PR = re.compile(r"^https://github\.com/(balancer)/(multisig-ops)/pull/([1-9][0-9]{0,6})$")
GITHUB_PR_IN_MATERIAL = re.compile(r"(?<![A-Za-z0-9_:/.-])https://github\.com/balancer/multisig-ops/pull/[1-9][0-9]{0,6}(?![A-Za-z0-9_?=&/.-])")
SNAPSHOT_PROPOSAL_LINK = re.compile(r"https://snapshot\.box/#/s:([a-z0-9][a-z0-9.-]{0,127})/proposal/(0x[0-9a-f]{64})", re.I)
GITHUB_SHA = re.compile(r"^[0-9a-f]{40}$", re.I)


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _bounded_text(value, field, limit, optional=False):
    if value is None and optional:
        return None
    if not isinstance(value, str) or len(value.encode("utf-8")) > limit or (not optional and not value.strip()):
        raise ValueError("invalid " + field)
    return value.strip()


def _source(raw):
    if not isinstance(raw, dict) or set(raw) != {"kind", "space", "proposalId"} or raw.get("kind") != "snapshot":
        raise ValueError("invalid Snapshot source")
    space = _bounded_text(raw.get("space"), "Snapshot space", 128)
    proposal_id = _bounded_text(raw.get("proposalId"), "Snapshot proposal ID", 128)
    if not SNAPSHOT_SOURCE.fullmatch(space) or not SNAPSHOT_ID.fullmatch(proposal_id):
        raise ValueError("invalid Snapshot source")
    return {"kind": "snapshot", "space": space.lower(), "proposalId": proposal_id}


def _grounded_actions(decision_ir, material):
    if not isinstance(decision_ir, dict) or decision_ir.get("schemaVersion") != "3.4":
        raise ValueError("evidence planning requires schema 3.4 Decision IR")
    if not isinstance(material, str) or len(material.encode("utf-8")) > MAX_MATERIAL_BYTES:
        raise ValueError("invalid canonical proposal material")
    grounding = decision_ir.get("grounding")
    if not isinstance(grounding, dict) or not isinstance(grounding.get("actions"), list):
        raise ValueError("evidence planning requires grounded Decision IR")
    statuses = {item.get("id"): item for item in grounding["actions"] if isinstance(item, dict)}
    actions = decision_ir.get("actions")
    if not isinstance(actions, list) or len(actions) > 16:
        raise ValueError("invalid Decision IR actions")
    reviewed = material.replace("**", "").replace("`", "")
    prepared = []
    for action in actions:
        if not isinstance(action, dict) or not isinstance(action.get("id"), str):
            raise ValueError("invalid Decision IR action")
        status = statuses.get(action["id"])
        if not isinstance(status, dict) or status.get("retained") is not True:
            raise ValueError("Decision IR action is not retained by grounding")
        if status.get("state") not in ("grounded", "partially_grounded"):
            raise ValueError("Decision IR action is unresolved")
        excerpt = action.get("sourceExcerpt")
        if not isinstance(excerpt, str) or not excerpt or excerpt not in material:
            raise ValueError("Decision IR action excerpt is not grounded")
        # The planner is defensive: it only uses values that still occur in
        # reviewed material, even though Phase 6.3 normally guarantees this.
        for name in ("target", "contract", "function", "asset", "amount", "recipient", "actor"):
            value = action.get(name)
            if value is not None and (not isinstance(value, str) or value not in reviewed):
                raise ValueError("Decision IR action field is not grounded")
        prepared.append(action)
    return sorted(prepared, key=lambda item: item["id"])


def parse_github_execution_reference(locator):
    """Accept only an exact, repository-specific supported PR URL."""
    if not isinstance(locator, str):
        return None
    match = GITHUB_PR.fullmatch(locator)
    if not match:
        return None
    return {"source": "github", "owner": match.group(1), "repository": match.group(2),
            "pullNumber": int(match.group(3)), "locator": locator}


def _item(adapter, related_id, locator, authority, temporal_scope, source, verification_scope="validator_retrieved_external_source", relation="action"):
    item = {"id": adapter + ":" + digest(locator)[:16], "actionIds": [], "claimIds": [],
            "adapter": adapter, "source": source, "locator": locator, "authority": authority,
            "verificationScope": verification_scope, "temporalScope": temporal_scope}
    item["actionIds" if relation == "action" else "claimIds"] = [related_id]
    return item


def plan_evidence(decision_ir, material, source, assessment_context):
    """Return a canonical, adapter-only plan from a grounded Decision IR.

    A plan has expected provenance for a future retrieval.  It intentionally
    has no content hash or retrieval time because it is not evidence yet.
    """
    if assessment_context not in ("live", "retrospective"):
        raise ValueError("invalid assessment context")
    source = _source(source)
    actions = _grounded_actions(decision_ir, material)
    items = []
    seen = set()
    def add(item):
        key = (item["adapter"], item["locator"])
        if key in seen:
            existing = next(candidate for candidate in items if (candidate["adapter"], candidate["locator"]) == key)
            for field in ("actionIds", "claimIds"):
                existing[field] = sorted(set(existing[field] + item[field]))
            return
        seen.add(key)
        items.append(item)
    for action in actions:
        operation = action.get("operation")
        action_id = action["id"]
        target = action.get("target")
        contract = action.get("contract")
        if operation in ("token_claim", "contract_call", "parameter_change", "contract_upgrade", "deployment", "bridge", "stake", "unstake", "liquidity_action"):
            locator = contract if isinstance(contract, str) and ADDRESS.fullmatch(contract) else target
            if isinstance(locator, str) and ADDRESS.fullmatch(locator):
                add(_item("ethereum_rpc_contract_state", action_id, locator.lower(), "secondary", "current_state_observed", "ethereum_rpc"))
            elif operation in ("token_claim", "contract_call"):
                # A named contract/function may still be relevant, but without
                # an address it cannot cause unbounded RPC discovery.
                function = action.get("function")
                if isinstance(function, str):
                    add(_item("ethereum_rpc_contract_state", action_id, "proposal:" + function, "contextual", "unknown", "ethereum_rpc"))
        if operation in ("control_change", "role_change"):
            locator = target if isinstance(target, str) and ADDRESS.fullmatch(target) else contract
            if isinstance(locator, str) and ADDRESS.fullmatch(locator):
                item = _item("safe_state", action_id, locator.lower(), "secondary", "current_state_observed", "ethereum_rpc")
                if assessment_context == "retrospective":
                    # Historical anchoring is an adapter result only after two
                    # providers agree. A plan may request it but cannot claim it.
                    item["historicalLookupRequired"] = True
                    item["fallbackTemporalScope"] = "current_state_observed"
                add(item)
        for tx_hash in TX_HASH_IN_MATERIAL.findall(action.get("sourceExcerpt", "")):
            add(_item("blockscout_transaction", action_id, tx_hash.lower(), "secondary", "inherently_historical", "blockscout"))

    claims = decision_ir.get("claims", [])
    if not isinstance(claims, list) or len(claims) > 16:
        raise ValueError("invalid Decision IR claims")
    for claim in claims:
        if not isinstance(claim, dict) or not isinstance(claim.get("id"), str):
            raise ValueError("invalid Decision IR claim")
        excerpt = claim.get("sourceExcerpt")
        target = claim.get("verificationTarget")
        if not isinstance(excerpt, str) or excerpt not in material or (target is not None and (not isinstance(target, str) or target not in material.replace("**", "").replace("`", ""))):
            raise ValueError("Decision IR claim is not grounded")
        for tx_hash in TX_HASH_IN_MATERIAL.findall(excerpt):
            add(_item("blockscout_transaction", claim["id"], tx_hash.lower(), "secondary", "inherently_historical", "blockscout", relation="claim"))
        if isinstance(target, str) and ADDRESS.fullmatch(target):
            add(_item("ethereum_rpc_contract_state", claim["id"], target.lower(), "secondary", "current_state_observed", "ethereum_rpc", relation="claim"))

    # GitHub is intentionally not accepted from decision-IR locators.  Only a
    # strict allowlisted URL physically present in reviewed material can plan a
    # contextual execution artifact.
    eligible = any(action.get("operation") in ("token_claim", "contract_call", "treasury_recovery", "treasury_transfer", "control_change") for action in actions)
    if eligible:
        for locator in GITHUB_PR_IN_MATERIAL.findall(material):
            reference = parse_github_execution_reference(locator)
            if reference:
                item = _item("github_execution_pr", "proposal", reference["locator"], "contextual", "unknown", "github")
                # A proposed payload/simulation is contextual execution
                # evidence, never evidence that the execution occurred.
                item["isExecutionProof"] = False
                add(item)
    # Snapshot governance history is a bounded, same-space relationship.  It
    # is deliberately not a general forum/URL crawler.
    history_ids = []
    for space, proposal_id in SNAPSHOT_PROPOSAL_LINK.findall(material):
        proposal_id = proposal_id.lower()
        if space.lower() != source["space"] or proposal_id == source["proposalId"].lower():
            continue
        if proposal_id not in history_ids:
            history_ids.append(proposal_id)
    if len(history_ids) > 3:
        raise ValueError("governance-history reference limit exceeded")
    for proposal_id in sorted(history_ids):
        add(_item("snapshot_governance_history", "proposal", proposal_id, "primary", "unknown", "snapshot"))
    if len(items) > MAX_PLAN_ITEMS:
        raise ValueError("evidence plan exceeds item limit")
    items.sort(key=lambda item: (item["adapter"], item["locator"], item["id"]))
    return {"schemaVersion": "3.4", "assessmentContext": assessment_context, "source": source, "items": items}


def _github_response_json(response):
    if getattr(response, "status", None) != 200:
        raise ValueError("GitHub execution source returned a non-success HTTP status")
    headers = getattr(response, "headers", {})
    content_type = ""
    if isinstance(headers, dict):
        for name, value in headers.items():
            if str(name).lower() == "content-type":
                content_type = str(value)
                break
    if content_type and not re.match(r"^application/(?:json|vnd\.github\+json)(?:\s*;|$)", content_type, re.I):
        raise ValueError("GitHub execution response has invalid content type")
    body = getattr(response, "body", None)
    if not isinstance(body, (str, bytes)):
        raise ValueError("GitHub execution response body is invalid")
    raw = body.encode("utf-8") if isinstance(body, str) else body
    if len(raw) > MAX_GITHUB_RESPONSE_BYTES:
        raise ValueError("GitHub execution response exceeds limit")
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except Exception as error:
        raise ValueError("GitHub execution response is not valid JSON") from error
    if not isinstance(parsed, dict):
        raise ValueError("GitHub execution response must be a JSON object")
    return parsed


def normalize_github_execution_evidence(reference, response, retrieved_at):
    """Normalize one allowlisted PR response into contextual evidence."""
    expected = parse_github_execution_reference(reference.get("locator") if isinstance(reference, dict) else None)
    if expected is None or reference != expected:
        raise ValueError("invalid allowlisted GitHub reference")
    if not isinstance(response, dict) or response.get("number") != expected["pullNumber"] or response.get("html_url") != expected["locator"]:
        raise ValueError("GitHub execution identity mismatch")
    if response.get("state") not in ("open", "closed") or response.get("base", {}).get("repo", {}).get("full_name") != "balancer/multisig-ops":
        raise ValueError("GitHub execution identity mismatch")
    commit = response.get("head", {}).get("sha")
    if not isinstance(commit, str) or not GITHUB_SHA.fullmatch(commit):
        raise ValueError("invalid GitHub execution commit anchor")
    title = _bounded_text(response.get("title"), "GitHub execution title", 300, True)
    body = _bounded_text(response.get("body"), "GitHub execution body", MAX_GITHUB_BODY, True)
    timestamp = _bounded_text(retrieved_at, "GitHub retrieval time", 40)
    normalized = {"number": expected["pullNumber"], "state": response["state"], "title": title, "body": body,
                  "commitAnchor": commit.lower(), "repository": "balancer/multisig-ops"}
    return {"id": "github_execution_pr:" + digest(expected["locator"])[:16], "type": "execution_payload",
            "source": "github", "locator": expected["locator"] + "@" + commit.lower(),
            "authority": "contextual", "verificationScope": "validator_retrieved_external_source",
            "temporalScope": "unknown", "contentHash": digest(canonical(normalized)), "retrievedAt": timestamp,
            "commitAnchor": commit.lower(), "isExecutionProof": False, "content": normalized}


def normalize_github_execution_response(reference, response, retrieved_at):
    """Bound a supplied allowlisted HTTP response before evidence normalization.

    Deliberately no web call lives here: a future consensus retrieval path must
    invoke this normalizer after its own equivalence-boundary web operation.
    """
    return normalize_github_execution_evidence(reference, _github_response_json(response), retrieved_at)


class EvidencePlannerV34(gl.Contract):
    """Stateless deterministic contract boundary for action-directed planning."""

    def __init__(self):
        pass

    @gl.public.view
    def get_schema(self) -> str:
        return "3.4"

    @gl.public.write
    def plan(self, decision_ir_json: str, material: str, source_json: str, assessment_context: str) -> str:
        if not isinstance(decision_ir_json, str) or not isinstance(source_json, str):
            raise gl.vm.UserError("invalid evidence plan input")
        try:
            return canonical(plan_evidence(json.loads(decision_ir_json), material, json.loads(source_json), assessment_context))
        except (TypeError, ValueError, json.JSONDecodeError):
            raise gl.vm.UserError("invalid evidence plan input")
