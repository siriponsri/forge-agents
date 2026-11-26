# Training dependency environments — worker handoff

Scope: generic local dependency management only, based on `6590cf6`. No CA-EWS
project, data acquisition, model experiment, cloud provisioning, application
server integration, credential migration or publication is performed here.
The master plan contributes Python 3.11/3.12, CPU-first, at most four numerical
library threads, seed 42, environment provenance and separation of research
profiles. Its embedded execution prompt is not activated.

## Implemented boundary

`tools/training-env/manage.py` is a stdlib Python CLI. It invokes the explicitly
selected CPython executable to create private `venv` environments and invokes
pip **only inside those environments**. It never invokes global pip, installs
Python, upgrades bootstrap tools, sources activation scripts, updates at startup,
or mutates a previously created training environment. No third-party Python
library is required by the manager itself. The selected Python installation
must already include working `venv`/`ensurepip`; missing Linux distribution
packages are an operator setup prerequisite, not an automatic sudo operation.

The manager is implemented for Windows and Linux; macOS and other platforms are
explicitly rejected. Real developer execution in this handoff is Windows
CPython 3.12.10 only. Linux/dr-train and Python 3.11 remain **NOT_RUN**.

| Profile | Default direct inputs | Intended scope and limits |
|---|---|---|
| `tabular` | numpy, pandas, scikit-learn, joblib | Minimal numerical/tabular/time-series feature and baseline work; no dataset reader, model or benchmark is supplied. |
| `vision` | numpy, Pillow | Image preparation; add a reviewed training framework explicitly. No implied GPU support. |
| `text` | numpy, transformers, tokenizers, safetensors | Text/tokenizer/model-format tooling; no weights or tensor backend downloaded implicitly. LLM training needs an explicitly selected backend and resource review. |

The bounds in `profiles` are **resolution inputs**, not tested, preselected
versions. All transitive packages are resolved to exact versions and SHA-256
hashes on the selected target before installation. These default scientific
profiles have **NOT_RUN** installation/fit qualification; the lifecycle tests use
tiny generated wheels. To change packages over time, supply a reviewed plain
requirements file to a new candidate. `--requirements` replaces the profile's
direct inputs; it does not silently append them. It accepts package names and
version constraints only, one per line, with whole-line comments. It rejects
URLs, credentials, options, nested files, extras and environment markers. Add
`--smoke-import MODULE` for each expected import when overriding requirements.

For future public time-series research, a reviewed input file could add WFDB,
pyarrow, pytest and optional matplotlib/DuckDB to the tabular inputs. Resolve
and test those packages at home first; this worker did not download them.
GPU candidates require both `--gpu` and an explicit requirements file. Choose
compatible framework/driver/wheels on the target and use a reviewed public
HTTPS index or an offline wheelhouse. No CUDA installation, hardware detection,
GPU reservation, device-memory qualification or claim of GPU success is made.

## Commands and lifecycle

All stateful commands require `--root ABSOLUTE_EXTERNAL_STORE --profile NAME`.
Choose a dedicated directory outside the repository, such as
`C:\FORGE-training-envs` or `/home/OWNER/forge-training-envs`. The examples below
are templates for the owner's machine and are not claims that those paths exist.

```text
python tools/training-env/manage.py profiles
python tools/training-env/manage.py prepare --root STORE --profile tabular --version cpu-001 --python ABSOLUTE_PYTHON --wheelhouse ABSOLUTE_WHEEL_DIRECTORY
python tools/training-env/manage.py create --root STORE --profile tabular --version cpu-001
python tools/training-env/manage.py verify --root STORE --profile tabular --version cpu-001
python tools/training-env/manage.py activate --root STORE --profile tabular --version cpu-001
python tools/training-env/manage.py status --root STORE --profile tabular
python tools/training-env/manage.py run --root STORE --profile tabular --script ABSOLUTE_TRUSTED_SCRIPT.py -- --job-option value
python tools/training-env/manage.py upgrade --root STORE --profile tabular --from cpu-001 --version cpu-002 --python ABSOLUTE_PYTHON --wheelhouse ABSOLUTE_NEW_WHEEL_DIRECTORY --requirements ABSOLUTE_REVIEWED_REQUIREMENTS
python tools/training-env/manage.py activate --root STORE --profile tabular --version cpu-002
python tools/training-env/manage.py rollback --root STORE --profile tabular
```

`prepare` and `upgrade` require exactly one source: `--wheelhouse` or
`--allow-network`. An online example, **for a later authorized home operation**:

```powershell
$trainingPython = 'C:\Python312\python.exe'
$trainingStore = 'C:\FORGE-training-envs'
& $trainingPython tools/training-env/manage.py prepare --root $trainingStore --profile tabular --version cpu-001 --python $trainingPython --allow-network
& $trainingPython tools/training-env/manage.py create --root $trainingStore --profile tabular --version cpu-001
& $trainingPython tools/training-env/manage.py activate --root $trainingStore --profile tabular --version cpu-001
```

Equivalent Linux command shape to run **on dr-train after SSH access is set up**:

```sh
/usr/bin/python3.12 tools/training-env/manage.py prepare --root /home/OWNER/forge-training-envs --profile tabular --version cpu-001 --python /usr/bin/python3.12 --allow-network
/usr/bin/python3.12 tools/training-env/manage.py create --root /home/OWNER/forge-training-envs --profile tabular --version cpu-001
/usr/bin/python3.12 tools/training-env/manage.py activate --root /home/OWNER/forge-training-envs --profile tabular --version cpu-001
```

`--allow-network` uses `https://pypi.org/simple` unless `--index-url` explicitly
selects one public HTTPS index. There is no extra-index mechanism. Authenticated
indexes, proxy credentials and arbitrary pip options are deliberately unsupported.
Network access is never implicit in create/verify/activate/rollback/run. The
offline wheelhouse must contain only wheel files, and every wheel is inspected
to reject direct-URL dependencies before resolution. Online resolution is a
trusted-source operation: pip may follow upstream distribution links. Verify the
chosen source and resource allowance before enabling it.

The state sequence is `PREPARING → PREPARED → VERIFIED`, or a durable
`FAILED_PREPARE` / `FAILED_CREATE`. A crash may leave `PREPARING` or an incomplete
directory; it cannot activate. Existing IDs are never overwritten. Failed
directories remain for inspection, and retries use a new version ID.

`upgrade` prepares and creates a **new** candidate and records the source
version and source lock hash. It does not change the active pointer. Review
the resulting lock, imports and project-specific smoke/fit evidence; then call
`activate` explicitly. Activation re-verifies the candidate and atomically writes
`active.json` with `current` and `previous`. Rollback re-verifies `previous`
before swapping the pointer; corrupt or failed candidates cannot replace the
current version. Repeated activation of the same version preserves rollback
history. Rollback toggles the two most recently selected versions; older versions
can be selected explicitly with `activate`.

`run --version ID` pins a particular environment. Without `--version`, it reads
the current pointer once. The launched interpreter's path remains unchanged if
another operation changes the active pointer. There is no environment deletion
or garbage collection command, so the CLI cannot delete a running environment.
It executes a trusted absolute `.py` script with an argv list, without a shell,
and returns that script's exit code. Script stdout/stderr are forwarded; scripts
must not print their own secrets or data prohibited from logs. The manager's
dependency/probe subprocess output is captured and not exposed on error.

Run defaults set `FORGE_TRAINING_SEED=42`, `PYTHONHASHSEED=42` and thread-limit
environment variables to four. `--cpus` accepts 1–4; `--seed` accepts a uint32.
These are numerical-library hints, **not an OS CPU quota or deterministic-fit
guarantee**. Project code must seed `random`, NumPy and the selected framework
from `FORGE_TRAINING_SEED`, configure worker counts, and record repeatability.
CPU candidates hide CUDA/HIP devices using standard environment variables;
this is not a hardware security boundary. The launcher also supplies selected
version and lock hash as `FORGE_TRAINING_ENV_VERSION` and
`FORGE_TRAINING_LOCK_SHA256` for run provenance.

## Reproducibility and safety details

Each version contains `metadata.json`, `requirements.lock`, `wheels/`, private
`resolver/`, a final-location `env/`, and `verification.json` after successful
creation. These are **generated local artifacts**, not repository lockfiles.
The manager does not move an environment after creation because venv paths are
not portable. Never copy a Windows venv to Linux or rename its parent directory.

Metadata records requested inputs and their hash, public source kind/URL,
resolver pip version, CPython implementation/patch version, platform, architecture,
SOABI, base interpreter executable hash, all resolved package versions/wheel
hashes, creation time and upgrade provenance. The input Python path is local
machine provenance, not a portable configuration value. The selected interpreter
must still match before creation; an interpreter upgrade requires a new candidate.

The lock contains an exact `==` pin and SHA-256 hash for every resolved wheel.
Create is offline with `--require-hashes --only-binary=:all: --no-deps`; the
complete lock is installed, then `pip check`, exact installed inventory and
configured imports are checked. Verification checks the wheel inventory and
hashes, lock bytes, interpreter target, package inventory, import success and
receipt consistency. `pip`/`setuptools`/`wheel` are bootstrap tooling, cannot be
requested as profile packages, and are recorded in verification inventory. They
come from the selected interpreter's `ensurepip`, which is not upgraded here.

To recreate after a failed creation, retain the original wheelhouse and generate
a plain pinned requirements file from its lock's package names/versions (omit
`--hash` tokens for the manager's input parser). Use a **new** version ID with
that wheelhouse and the same interpreter. Compare the new lock's SHA-256 with
the old lock before activation. This resolves only already-frozen wheels, with
no network. There is no bundle import/export or automatic cross-target lock
translation in this implementation. Resolution for a different OS/architecture
must happen on that target and produces a separate lock.

Managed paths reject traversal, symlink/reparse/junction components, and Windows
reserved version names. Base Python symlinks are allowed for normal Linux Python
installations. An existing nonempty directory without the store marker cannot
be adopted. An exclusive mutation lock serializes mutations; a stale lock is
never removed automatically. Inspect the recorded PID and verify no manager is
running before manually removing **only** that store's `.mutation.lock`.
No recursive deletion or arbitrary path cleanup is implemented.

The filesystem is assumed to be private to a trusted owner. Hashes protect
against accidental damage and drift; they are not signatures and do not protect
against a malicious owner replacing both artifacts and metadata. Verification
checks inventory/imports, not every installed source file's contents. Wheels,
imports and user scripts are executable code and must come from trusted sources;
a venv is dependency isolation, not a sandbox. No credential environment
variables, pip configuration variables, `PYTHONPATH` or proxy settings are
forwarded to child processes. OS path/temp essentials are retained. The manager
does not accept secrets in CLI options; local scripts can still read files their
OS account can access.

## Universal Training App integration plan (not implemented here)

1. In per-project Compute/Environment settings, let the owner select profile,
   interpreter, target and a dedicated store; show implementation support
   separately from live qualification. Discover an interpreter without silently
   installing or changing it. Show GPU as an explicit capability choice.
2. A Prepare action submits the exact selected interpreter, reviewed requirement
   inputs and source choice. Show candidate state, pinned package diff, lock hash,
   source and actual errors. Never trigger prepare or upgrade on startup/reload.
3. Create/Verify runs the CLI through the existing owned job/process boundary.
   Register the metadata, lock and verification receipt as task artifacts. A
   verified dependency environment is not a verified research model.
4. Keep Activate and Rollback explicit owner actions. Persist the project's
   selected version, then copy its exact version/lock hash into each job record
   before dispatch. A running job retains its selection after an upgrade.
5. Use `run` or the verified absolute interpreter for a trusted job entry point.
   The existing job controller owns cancellation, process-tree cleanup, progress,
   artifacts and durable job receipts. A no-code screen must not expose arbitrary
   shell commands or call this tool outside that authority boundary.
6. For dr-train over SSH, deploy the manager/source and build a **Linux** candidate
   on dr-train using its explicit Python. Return only approved metadata/evidence.
   RunPod/Vast/Colab stay separate target adapters; this CLI does not authenticate,
   reserve, start, stop or charge for their compute. Later ephemeral targets need
   durable wheel/lock storage and explicit re-creation, not copied venvs.
7. Per-framework project validation adds a tiny actual fit/inference check, dataset
   governance, split/feature hashes, saved preprocessing/model artifacts and
   held-out evidence. Then qualify target interruption/reconnect, stop, rollback,
   resource limits and home UAT. Clinical/prototype permissions remain separate.

**Implementation gaps outside this worker's assigned paths:** app GUI/API wiring,
owned remote transport, job cancellation/process-tree enforcement, lifecycle audit
integration and scientific training recipes are not implemented by this CLI.
They must not be labelled complete because the CLI tests pass. Private package
indexes, environment export/import, automatic retention and OS resource quotas
are deliberately unsupported features, not missing live credentials.

## Verification evidence

Command: `python tests/training-env.test.py` on Windows CPython 3.12.10.
Result on 2026-11-26: **11 tests PASS, 0 skips, exit 0, 91.079 seconds**.
The suite generates tiny standard wheel ZIPs in a disposable directory, runs real
venv/ensurepip/pip offline, and does not fetch scientific packages or contact cloud
services. It covers prepare/create/verify; refusal to activate an uncreated
candidate; duplicate-version and in-place-create rejection; exact wheel pins and
hashes; running current and explicitly pinned older versions; preserving an
already running v1 job while activating v2; explicit upgrade
with previous lock provenance and no autoactivation; activation and rollback;
failed dependency resolution/import with durable failure states; corrupt lock/
wheel refusal; and preservation of the current pointer after failures.

Unit tests cover argv/no-shell invocation, sanitized environment and child errors,
timeout handling, path traversal/reserved IDs, symlink/junction rejection (mocked),
exclusive mutation locking, refusal to adopt nonempty paths, index/requirements
injection, unsupported interpreter/platform rejection, and offline direct-URL
dependency rejection. No skip is expected under the tested Python 3.12.

Additional checks: `python tools/training-env/manage.py profiles`, CLI help, and
`git diff --check` passed. Invalid negative seed CLI input exits with a bounded
validation error. After the full suite, the test loader was changed only to
suppress repository bytecode generation; its unit tests were checked again.

**NOT_RUN:** Linux/dr-train execution, Python 3.11 execution, macOS (unsupported),
GPU/CUDA/ROCm, actual scientific-profile installation, any model/data experiment,
network dependency resolution, RunPod/Vast/Colab, fresh home machine and app GUI
integration. **HOME_UAT_NOT_RUN.** No live credentials are required for the
completed offline tests; unavailable external qualification is separate from the
implementation gaps above.

## Primary documentation checked for this handoff

Checked 2026-11-26. Documentation compatibility is not this worker's runtime
qualification. The implementation does not require the newest pip/uv version.

- [Python 3.12 venv](https://docs.python.org/3.12/library/venv.html): isolated
  environments can be invoked by absolute interpreter path without activation;
  their embedded absolute paths make environments nonportable. Python 3.12 no
  longer includes setuptools as a core venv dependency.
- [pip installation compatibility](https://pip.pypa.io/en/stable/installation/#compatibility):
  current pip lists CPython 3.11 and 3.12 among supported versions; latest patch
  versions are tested upstream, earlier patches supported on a best-effort basis.
- [pip secure installs](https://pip.pypa.io/en/stable/topics/secure-installs/):
  hash checking requires pins and hashes for the entire dependency closure;
  `--only-binary=:all:` excludes source distributions.
- [pip download](https://pip.pypa.io/en/stable/cli/pip_download/): wheel selection
  depends on interpreter/platform/ABI. This CLI intentionally resolves with the
  actual selected target interpreter instead of guessing cross-platform tags.
- [pip configuration](https://pip.pypa.io/en/stable/topics/configuration/):
  `PIP_CONFIG_FILE=os.devnull` disables configuration-file loading. The manager
  sets this in its filtered child environment and also uses pip isolated mode.
- [uv locking environments](https://docs.astral.sh/uv/pip/compile/): uv supports
  compiled requirements and explicit package/all-package upgrades. It was
  considered as an optional future resolver, but **no uv runtime integration or
  uv compatibility claim is included**; stdlib plus interpreter-bundled pip keeps
  this worker's bootstrap small and directly tested.
