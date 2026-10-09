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
`0xf183c38364Bc92726E54d3639a6c4f8d107630c7`. Earlier evaluation contracts and
records remain historical and immutable. Fixed provider evidence is secondary;
it is not represented as a cryptographic state or inclusion proof.
