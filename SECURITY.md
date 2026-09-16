# Security Policy

## Reporting

Report suspected vulnerabilities privately to the repository owner. Do not
publish credentials, exploit details, provider-home data or browser profiles in
an issue.

## Security boundaries

- Provider homes must remain separate and are never copied, merged or switched.
- AO Limited must use one loopback daemon boundary per provider.
- AO account-management and authentication surfaces are denied.
- Native execution is the default; AO is explicit, worker-only and reversible.
- No credentials, model-provider state or browser profiles belong in this repo.
