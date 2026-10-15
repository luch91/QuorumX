# QuorumX format history

This document records internal schema history needed to read immutable records.
The public product is QuorumX Due Diligence and exposes formats 1, 2, and 3.

## Format 1

`GovernanceRiskOracle` stored the historical score model. Its accepted records
remain readable and are not reinterpreted as due-diligence findings.

## Format 2

`GovernanceDueDiligence` introduced proposal-grounded structured actions,
claims, findings, safeguards, execution steps, questions, and review priority.
Its evidence boundary is the independently retrieved proposal.

## Format 3 internal schemas

- Schema 3.1 added bounded Blockscout returned-funds evidence.
- Schema 3.2 added dual-provider Safe JSON-RPC checks at one finalized block.
- Schema 3.3 added immutable run IDs, bounded Snapshot governance-history
  evidence, expanded safeguard and execution relationships, and the current
  independently derived structured report.
- Schema 3.4 adds a grounded Decision IR and deterministic evidence plan while
  retaining bounded Safe configuration checks. It is an internal compatibility
  schema within public Format 3, not a new public product version.

These labels remain in contract state, database rows, and parsers solely so
historical immutable records can be decoded exactly. New compatible product
work remains format 3 and does not create a new public decimal version.

The active production-routed Format 3 contract is
`0x7a0a7384B24C8dbb896F305cc3e055eF7a8fDe8F` (deployment transaction
`0x13c002a85fabe2056b1506c5406adcbee10cf842ee12071f32160c9db165fb6b`).
It replaced `0x319e020B2cf81a5c1D7E6d8F831B8F0c531ea860` (deployment transaction
`0x8db0a0e5be933c1fb025e1a8431b1d60eb912a86b543ed13cf12700320da12ae`)
after its narrower 24 KB canonical-material guard rejected a valid bounded
Snapshot response. Snapshot responses remain capped at 64 KB before parsing.
The preceding schema 3.3 address was
`0xf183c38364Bc92726E54d3639a6c4f8d107630c7` (deployment transaction
`0x600796d8eafe99df247004bd8f400b531884894adef8de540409b3bb4befdb50`).
These replacements do not change the public format or schema label. Prior
addresses, their evaluation contracts, and accepted records remain historical
and immutable. Fixed provider evidence is secondary; it is not represented as
a cryptographic state or inclusion proof.

Schema 3.4 is deployed separately on Studionet at
`0x312310d6D2aFA84bC55A7D6fAc68a623cBDD11c4` (deployment transaction
`0x5e28c52d72839867ae880af5bef40121faad5b1d20f88b45d404e3c8306a58d6`).
The ordinary Worker route remains on schema 3.3. The isolated BIP-933 canary
job was created and its runner invoked once, but the job remains pending because
both rolling live-assessment slots for Balancer were occupied. No canary
transaction or accepted schema 3.4 assessment exists. Deployment and localnet
schema smoke tests do not establish live canary acceptance or global rollout readiness.
