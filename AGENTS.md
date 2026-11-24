# FORGE development

Current requirements: `docs/owner/forge-local-complete-20261124-v3/00_START_HERE_TH.md`
and its `prompts/START_FULL_PRODUCT.txt`. Read the applicable handoff documents.

Preserve `bootstrap/payload`, `bootstrap/P11_PORTABLE_PACKAGE_MANIFEST.json`,
legacy `runtime/`, `adapters/ao` and their integrity/authority boundaries.
The new product lives in `app/`; legacy portable launchers retain their meaning.
Do not activate CA-EWS or another prototype, migrate credentials, purchase compute,
expose a public service, or push without the active release authorization.

Lead owns shared contracts, migrations, manifests/lockfiles and central progress.
Each worker writes in its own branch/worktree and only its assigned paths.
Report implementation gaps separately from missing live credentials/home UAT.
