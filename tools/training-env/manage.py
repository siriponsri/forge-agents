#!/usr/bin/env python3
"""Explicit, wheel-only training environment lifecycle. Python stdlib only."""
import argparse
import contextlib
import datetime
import email.parser
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import urllib.parse
import uuid
import zipfile

PROFILES = {
    "tabular": {"requirements": ["numpy>=1.26,<3", "pandas>=2.2,<3", "scikit-learn>=1.4,<2", "joblib>=1.3,<2"], "imports": ["numpy", "pandas", "sklearn", "joblib"]},
    "vision": {"requirements": ["numpy>=1.26,<3", "Pillow>=10,<13"], "imports": ["numpy", "PIL"]},
    "text": {"requirements": ["numpy>=1.26,<3", "transformers>=4.40,<6", "tokenizers>=0.19,<1", "safetensors>=0.4,<1"], "imports": ["numpy", "transformers", "tokenizers", "safetensors"]},
}
IDENT = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\Z")
NAME = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*\Z")
SPEC = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]*(?:(?:==|>=|<=|~=|>|<|!=)[A-Za-z0-9.*+!_-]+(?:\.[A-Za-z0-9.*+!_-]+)*(?:,(?:==|>=|<=|~=|>|<|!=)[A-Za-z0-9.*+!_.-]+)*)?\Z")
REPO = Path(__file__).resolve().parents[2]
MARKER = {"format": "forge-training-env", "schema": 1}


class EnvError(Exception):
    pass


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def safe_path(value, *, links=False):
    path = Path(value)
    if not path.is_absolute() or ".." in path.parts:
        raise EnvError("Paths must be absolute and contain no parent traversal.")
    if not links:
        for part in [path, *path.parents]:
            reparse = part.exists() and bool(getattr(part.lstat(), "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0))
            if part.is_symlink() or reparse or (hasattr(part, "is_junction") and part.is_junction()):
                raise EnvError("Managed and input paths cannot traverse links or junctions.")
    return path


def identifier(value):
    if not IDENT.fullmatch(value) or value.upper().split(".")[0] in {"CON", "PRN", "AUX", "NUL", *[f"COM{i}" for i in range(10)], *[f"LPT{i}" for i in range(10)]}:
        raise EnvError("Invalid version identifier.")
    return value


def uint32(value):
    try:
        number = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Seed must be an integer from 0 to 4294967295.") from None
    if not 0 <= number < 2**32:
        raise argparse.ArgumentTypeError("Seed must be an integer from 0 to 4294967295.")
    return number


def read_json(path):
    safe_path(path)
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_json(path, value):
    safe_path(path)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    with tmp.open("x", encoding="utf-8") as stream:
        json.dump(value, stream, sort_keys=True, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(tmp, path)


def store(value, initialize=False):
    root = safe_path(value)
    if root == Path(root.anchor) or root == Path.home() or root == REPO or REPO in root.parents or root == Path(sys.prefix) or Path(sys.prefix) in root.parents:
        raise EnvError("Use a dedicated external environment store, outside the repository and Python installation.")
    if not root.exists():
        if not initialize:
            raise EnvError("Environment store does not exist.")
        root.mkdir(parents=True)
    marker = root / "store.json"
    if not marker.exists():
        if not initialize or any(root.iterdir()):
            raise EnvError("Refusing to adopt a nonempty or uninitialized directory.")
        # Exclusive initialization: never overwrite a concurrent creator's marker.
        with marker.open("x", encoding="utf-8") as stream:
            json.dump(MARKER, stream)
    if read_json(marker) != MARKER:
        raise EnvError("Unrecognized environment store.")
    return root


@contextlib.contextmanager
def mutation(root):
    path = safe_path(root / ".mutation.lock")
    try:
        fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise EnvError("Store is busy. A stale mutation lock requires operator inspection.") from None
    try:
        with os.fdopen(fd, "w") as stream:
            stream.write(str(os.getpid()))
        yield
    finally:
        path.unlink()


def child_env(gpu=False, cpus=4, seed=42):
    # Do not forward credentials, proxies, PYTHONPATH, pip config, or user-site options.
    allowed = {"SYSTEMROOT", "WINDIR", "COMSPEC", "PATH", "PATHEXT", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"}
    env = {k: v for k, v in os.environ.items() if k.upper() in allowed}
    env.update({"PIP_CONFIG_FILE": os.devnull, "PIP_DISABLE_PIP_VERSION_CHECK": "1", "PIP_NO_INPUT": "1", "PYTHONNOUSERSITE": "1", "PYTHONHASHSEED": str(seed), "FORGE_TRAINING_SEED": str(seed)})
    for key in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMEXPR_NUM_THREADS", "VECLIB_MAXIMUM_THREADS"):
        env[key] = str(cpus)
    if not gpu:
        env["CUDA_VISIBLE_DEVICES"] = ""
        env["HIP_VISIBLE_DEVICES"] = ""
    return env


def call(argv, stage, *, timeout=600, env=None):
    try:
        result = subprocess.run([str(x) for x in argv], env=env or child_env(), capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise EnvError(f"{stage} could not complete; child output withheld.") from None
    if result.returncode:
        raise EnvError(f"{stage} failed (exit {result.returncode}); child output withheld.")
    return result.stdout


PROBE = "import json,sys,sysconfig,platform,hashlib,pathlib; print(json.dumps(dict(version=list(sys.version_info[:3]),implementation=sys.implementation.name,platform=sysconfig.get_platform(),machine=platform.machine(),soabi=sysconfig.get_config_var('SOABI'),base_sha256=hashlib.sha256(pathlib.Path(sys._base_executable).read_bytes()).hexdigest())))"


def probe(python):
    python = safe_path(python, links=True)  # /usr/bin/python3 may be a legitimate symlink.
    info = json.loads(call([python, "-I", "-c", PROBE], "Interpreter probe"))
    if info["implementation"] != "cpython" or info["version"][:2] not in ([3, 11], [3, 12]):
        raise EnvError("Only explicit CPython 3.11 or 3.12 interpreters are supported.")
    if not (info["platform"].startswith("win") or info["platform"].startswith("linux")):
        raise EnvError("Only Windows and Linux targets are implemented; macOS is not qualified.")
    return info


def env_python(directory):
    safe_path(directory)
    binaries = safe_path(directory / ("Scripts" if os.name == "nt" else "bin"))
    return binaries / ("python.exe" if os.name == "nt" else "python")


def pip(python, *args):
    return call([python, "-I", "-m", "pip", "--isolated", "--disable-pip-version-check", "--no-input", "--no-cache-dir", *args], "pip")


def requirements(args):
    if args.requirements:
        path = safe_path(args.requirements)
        lines = [line.strip() for line in path.read_text(encoding="utf-8").splitlines() if line.strip() and not line.lstrip().startswith("#")]
    else:
        lines = PROFILES[args.profile]["requirements"]
    if not lines or any(not SPEC.fullmatch(line) for line in lines):
        raise EnvError("Requirements must contain only plain package names/version constraints; no URLs, options, includes, extras or markers.")
    return lines


def index_url(value):
    url = urllib.parse.urlsplit(value)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
        raise EnvError("Index must be a public HTTPS URL without credentials, query or fragment.")
    return value


def version_dir(root, profile, version):
    return safe_path(root / profile / "versions" / identifier(version))


def lock_text(packages):
    return "".join(f"{p['name']}=={p['version']} --hash=sha256:{p['sha256']}\n" for p in packages)


def wheel_record(path):
    with zipfile.ZipFile(path) as archive:
        metas = [n for n in archive.namelist() if n.endswith(".dist-info/METADATA")]
        if len(metas) != 1:
            raise EnvError("Wheel must have exactly one distribution metadata record.")
        msg = email.parser.BytesParser().parsebytes(archive.read(metas[0]))
    if any("@" in dependency or "://" in dependency for dependency in msg.get_all("Requires-Dist", [])):
        raise EnvError("Direct URL wheel dependencies are not supported; use plain package dependencies.")
    name, version = msg.get("Name", ""), msg.get("Version", "")
    if not NAME.fullmatch(name) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.!+_-]*", version):
        raise EnvError("Invalid wheel distribution metadata.")
    name = re.sub(r"[-_.]+", "-", name).lower()
    if name in {"pip", "setuptools", "wheel"}:
        raise EnvError("Bootstrap tooling cannot be replaced through a training profile.")
    return {"name": name, "version": version, "file": path.name, "sha256": digest(path)}


def prepare(root, args):
    target = probe(args.python)
    lines = requirements(args)
    if args.gpu and not args.requirements:
        raise EnvError("GPU candidates require an explicit reviewed requirements file and wheel source.")
    if args.index_url and not args.allow_network:
        raise EnvError("Index use requires --allow-network.")
    source = {"kind": "local-wheels"}
    if args.wheelhouse:
        wheelhouse = safe_path(args.wheelhouse)
        if not wheelhouse.is_dir():
            raise EnvError("Local wheelhouse does not exist.")
        for entry in wheelhouse.iterdir():
            safe_path(entry)
            if not entry.is_file() or entry.suffix != ".whl":
                raise EnvError("Local wheelhouse must contain only wheel files.")
            wheel_record(entry)  # Refuse direct-URL dependencies before offline resolution.
        source_args = ["--no-index", "--find-links", str(wheelhouse)]
    else:
        source = {"kind": "public-index", "url": index_url(args.index_url or "https://pypi.org/simple")}
        source_args = ["--index-url", source["url"]]
    previous = None
    if args.command == "upgrade":
        previous_dir, previous_meta = bundle(root, args.profile, args.from_version)
        if previous_meta["state"] != "VERIFIED":
            raise EnvError("Upgrade source must be a verified version.")
        previous = {"version": args.from_version, "lock_sha256": digest(previous_dir / "requirements.lock")}
    directory = version_dir(root, args.profile, args.version)
    directory.mkdir(parents=True, exist_ok=False)
    meta = {"schema": 1, "profile": args.profile, "version": args.version, "state": "PREPARING", "created_at": stamp(), "python": str(safe_path(args.python, links=True)), "target": target, "gpu_requested": args.gpu, "source": source, "upgrade_from": previous, "requested": lines, "request_sha256": hashlib.sha256(canonical(lines)).hexdigest(), "imports": args.smoke_import or ([] if args.requirements else PROFILES[args.profile]["imports"])}
    atomic_json(directory / "metadata.json", meta)
    try:
        resolver = directory / "resolver"
        call([args.python, "-I", "-m", "venv", str(resolver)], "Resolver venv creation")
        resolver_python = env_python(resolver)
        meta["resolver"] = pip(resolver_python, "--version").strip().split(" from ")[0]
        wheels = directory / "wheels"
        wheels.mkdir()
        pip(resolver_python, "download", "--only-binary=:all:", "--dest", str(wheels), *source_args, *lines)
        packages = sorted([wheel_record(p) for p in wheels.iterdir() if p.suffix == ".whl"], key=lambda p: p["name"])
        if not packages or len({p["name"] for p in packages}) != len(packages) or len(packages) != len(list(wheels.iterdir())):
            raise EnvError("Resolved wheel set is empty, duplicated, or contains non-wheel artifacts.")
        (directory / "requirements.lock").write_text(lock_text(packages), encoding="utf-8", newline="\n")
        meta.update(packages=packages, lock_sha256=digest(directory / "requirements.lock"), state="PREPARED")
        atomic_json(directory / "metadata.json", meta)
    except Exception:
        meta["state"] = "FAILED_PREPARE"
        atomic_json(directory / "metadata.json", meta)
        raise
    return directory, meta


def bundle(root, profile, version):
    directory = version_dir(root, profile, version)
    meta = read_json(directory / "metadata.json")
    if meta["schema"] != 1 or meta["profile"] != profile or meta["version"] != version or meta["state"] not in {"PREPARED", "VERIFIED"}:
        raise EnvError("Version is not a prepared/verified candidate.")
    lock = safe_path(directory / "requirements.lock")
    if digest(lock) != meta["lock_sha256"] or lock.read_text(encoding="utf-8") != lock_text(meta["packages"]):
        raise EnvError("Lock integrity check failed.")
    wheels = safe_path(directory / "wheels")
    if {p.name for p in wheels.iterdir()} != {p["file"] for p in meta["packages"]}:
        raise EnvError("Wheel inventory changed.")
    for package in meta["packages"]:
        name = package["file"]
        if Path(name).name != name or not name.endswith(".whl"):
            raise EnvError("Unsafe wheel filename.")
        if digest(safe_path(wheels / name)) != package["sha256"]:
            raise EnvError("Wheel integrity check failed.")
    return directory, meta


def verify(root, profile, version, *, creating=False):
    directory, meta = bundle(root, profile, version)
    if not creating and meta["state"] != "VERIFIED":
        raise EnvError("Candidate has not completed creation.")
    python = env_python(directory / "env")
    if probe(python) != meta["target"]:
        raise EnvError("Interpreter target differs from lock provenance; prepare a new version.")
    pip(python, "check")
    inventory = json.loads(pip(python, "list", "--format=json"))
    actual = {re.sub(r"[-_.]+", "-", p["name"]).lower(): p["version"] for p in inventory}
    expected = {p["name"]: p["version"] for p in meta["packages"]}
    if {k: v for k, v in actual.items() if k not in {"pip", "setuptools", "wheel"}} != expected:
        raise EnvError("Installed distributions differ from the locked inventory.")
    imports = meta["imports"]
    if any(not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_.]*", name) for name in imports):
        raise EnvError("Invalid smoke import name.")
    call([python, "-I", "-c", "import importlib,json; [importlib.import_module(n) for n in json.loads(" + repr(json.dumps(imports)) + ")]"], "Import verification", env=child_env(meta["gpu_requested"]))
    evidence = {"target": meta["target"], "lock_sha256": meta["lock_sha256"], "inventory": actual, "imports": imports}
    if not creating and read_json(directory / "verification.json")["evidence"] != evidence:
        raise EnvError("Verification receipt differs from current environment.")
    return directory, meta, evidence


def create(root, profile, version):
    directory, meta = bundle(root, profile, version)
    if meta["state"] != "PREPARED" or (directory / "env").exists():
        raise EnvError("Creation requires a new prepared candidate; existing environments are never updated.")
    if probe(meta["python"]) != meta["target"]:
        raise EnvError("Selected interpreter changed since preparation.")
    try:
        call([meta["python"], "-I", "-m", "venv", str(directory / "env")], "Candidate venv creation")
        pip(env_python(directory / "env"), "install", "--no-index", "--no-deps", "--only-binary=:all:", "--require-hashes", "--find-links", str(directory / "wheels"), "-r", str(directory / "requirements.lock"))
        _, _, evidence = verify(root, profile, version, creating=True)
        atomic_json(directory / "verification.json", {"verified_at": stamp(), "evidence": evidence})
        meta["state"] = "VERIFIED"
        atomic_json(directory / "metadata.json", meta)
    except Exception:
        meta["state"] = "FAILED_CREATE"
        atomic_json(directory / "metadata.json", meta)
        raise
    return {"state": "VERIFIED", "profile": profile, "version": version, "activated": False}


def pointer(root, profile):
    path = safe_path(root / profile / "active.json")
    return read_json(path) if path.exists() else {"current": None, "previous": None}


def activate(root, profile, version, rollback=False):
    current = pointer(root, profile)
    if rollback:
        version = current["previous"]
        if not version:
            raise EnvError("No previous version is available for rollback.")
    verify(root, profile, version)
    if current["current"] != version:
        current = {"current": version, "previous": current["current"], "changed_at": stamp()}
        atomic_json(root / profile / "active.json", current)
    return current


def run(root, args):
    version = args.version or pointer(root, args.profile)["current"]
    if not version:
        raise EnvError("No active environment; activate explicitly or supply --version.")
    directory, meta, _ = verify(root, args.profile, version)
    script = safe_path(args.script)
    if not script.is_file() or script.suffix != ".py":
        raise EnvError("Run requires an existing absolute Python script path.")
    # No shell; version path remains stable even if active pointer changes mid-job.
    env = child_env(meta["gpu_requested"], args.cpus, args.seed)
    env["FORGE_TRAINING_ENV_VERSION"] = version
    env["FORGE_TRAINING_LOCK_SHA256"] = meta["lock_sha256"]
    argv = args.script_args[1:] if args.script_args[:1] == ["--"] else args.script_args
    return subprocess.call([str(env_python(directory / "env")), "-s", str(script), *argv], env=env)


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    commands = p.add_subparsers(dest="command", required=True)
    commands.add_parser("profiles")
    for command in ("prepare", "create", "upgrade", "verify", "activate", "rollback", "status", "run"):
        sub = commands.add_parser(command)
        sub.add_argument("--root", required=True, help="Absolute external dedicated store")
        sub.add_argument("--profile", required=True, choices=PROFILES)
        if command not in {"rollback", "status"}:
            sub.add_argument("--version", required=command != "run")
        if command in {"prepare", "upgrade"}:
            sub.add_argument("--python", required=True, help="Absolute CPython 3.11/3.12 executable")
            source = sub.add_mutually_exclusive_group(required=True)
            source.add_argument("--wheelhouse")
            source.add_argument("--allow-network", action="store_true")
            sub.add_argument("--index-url")
            sub.add_argument("--requirements", help="Replace profile requirements with a reviewed spec file")
            sub.add_argument("--smoke-import", action="append", default=[])
            sub.add_argument("--gpu", action="store_true")
        if command == "upgrade":
            sub.add_argument("--from", dest="from_version", required=True)
        if command == "run":
            sub.add_argument("--cpus", type=int, choices=range(1, 5), default=4)
            sub.add_argument("--seed", type=uint32, default=42, metavar="UINT32")
            sub.add_argument("--script", required=True)
            sub.add_argument("script_args", nargs=argparse.REMAINDER)
    return p


def main(argv=None):
    args = parser().parse_args(argv)
    try:
        if args.command == "profiles":
            result = {"profiles": PROFILES, "python": ["3.11", "3.12"], "cpu_threads_default": 4, "seed_default": 42, "gpu": "opt-in, unqualified", "profile_qualification": "NOT_RUN; resolve and test on target"}
        else:
            root = store(args.root, args.command in {"prepare", "upgrade"})
            if args.command == "run":
                return run(root, args)
            with mutation(root):
                if args.command in {"prepare", "upgrade"}:
                    _, meta = prepare(root, args)
                    result = {"state": meta["state"], "version": args.version, "lock_sha256": meta["lock_sha256"]}
                    if args.command == "upgrade":
                        result = create(root, args.profile, args.version)
                elif args.command == "create":
                    result = create(root, args.profile, args.version)
                elif args.command == "verify":
                    _, _, evidence = verify(root, args.profile, args.version)
                    result = {"state": "VERIFIED", "evidence": evidence}
                elif args.command in {"activate", "rollback"}:
                    result = activate(root, args.profile, getattr(args, "version", None), args.command == "rollback")
                else:
                    versions = safe_path(root / args.profile / "versions")
                    result = {"active": pointer(root, args.profile), "versions": []}
                    for entry in sorted(versions.iterdir()) if versions.exists() else []:
                        meta_path = safe_path(entry / "metadata.json")
                        result["versions"].append({"version": entry.name, "state": read_json(meta_path)["state"] if meta_path.exists() else "INCOMPLETE"})
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except EnvError as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile):
        # Never expose raw subprocess output, URLs, input contents or exception paths.
        print(json.dumps({"error": "Operation failed: invalid artifact, unavailable path, or I/O error. Existing active environment was preserved."}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
