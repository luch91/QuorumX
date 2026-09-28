# Security policy

## Reporting a vulnerability

Do not open a public issue for a vulnerability or exposed credential. Use the repository's **Security → Report a vulnerability** flow to send a private report to the maintainer.

Include the affected commit, impact, minimal reproduction, and any suggested mitigation. Remove private keys, access tokens, wallet seed phrases, and personally identifying data from logs and screenshots.

## Scope

Security reports are especially useful for:

- consensus or source-normalization bypasses;
- prompt-injection paths that can alter contract instructions;
- SSRF or private-network access through public URL ingestion;
- incorrect provenance or accepted-state reporting;
- duplicate transaction submission or private-key exposure.

Studionet uses development GEN. Its deployment is evidence of working consensus behavior, not a production-security guarantee.
