# OWNER Guide

1. Review the portable package identifiers in `release/manifest.json`.
2. Run `bootstrap\bootstrap.cmd` on a supported Windows host.
3. Authenticate providers only through their native tools and native homes.
4. Run `bootstrap\doctor.cmd`, then `bootstrap\launch-forge.cmd`.
5. Keep AO disabled unless a bounded worker task explicitly requires it.

The bootstrap is idempotent and includes an explicit rollback command. It does
not install AO, modify global PATH, or copy provider credentials.
