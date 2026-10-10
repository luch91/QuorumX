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

These labels remain in contract state, database rows, and parsers solely so
historical immutable records can be decoded exactly. New compatible product
work remains format 3 and does not create a new public decimal version.

The current format 3 Studionet contract is
`0x319e020B2cf81a5c1D7E6d8F831B8F0c531ea860` (deployment transaction
`0x8db0a0e5be933c1fb025e1a8431b1d60eb912a86b543ed13cf12700320da12ae`). It
replaced the prior format 3.3 address,
`0xf183c38364Bc92726E54d3639a6c4f8d107630c7` (deployment transaction
`0x600796d8eafe99df247004bd8f400b531884894adef8de540409b3bb4befdb50`), for
the long-proposal passage-boundary correction. This does not change the public
format or schema label: both deployments use format 3, schema 3.3. The prior
address, its evaluation contracts, and its accepted records remain historical
and immutable. Fixed provider evidence is secondary; it is not represented as a
cryptographic state or inclusion proof.
