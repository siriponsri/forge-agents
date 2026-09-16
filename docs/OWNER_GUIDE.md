# OWNER Guide

1. Review the portable package identifiers in `release/manifest.json`.
2. Run `bootstrap\bootstrap.cmd` on a supported 64-bit Windows host.
3. Authenticate providers only through their native tools and native homes.
4. Run `bootstrap\doctor.cmd`; proceed on `READY` or `READY_WITH_MISSING_OPTIONAL_PROVIDER`.
5. Run `bootstrap\launch-forge.cmd` and keep its console open while FORGE runs.
6. Keep AO disabled unless a bounded worker task explicitly requires it.
7. Keep Orca disabled; P11.5 classifies it as reference-only, not a FORGE backend.

The bootstrap is idempotent and includes an explicit rollback command. It does
not install AO or Orca, modify global PATH, or copy provider credentials. Read
the repository `README.md` for the complete no-code runbook and troubleshooting.
