"""Offline integration tests: generated tiny wheels, real venv/pip, no downloads."""
import base64
import csv
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock
import zipfile

CLI = Path(__file__).resolve().parents[1] / "tools/training-env/manage.py"
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("training_env", CLI)
manager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(manager)


def wheel(directory, version="1.0", dependency=None):
    dist = f"forge_tiny-{version}.dist-info"
    files = {
        "forge_tiny/__init__.py": f"VALUE = {version!r}\n".encode(),
        f"{dist}/METADATA": (f"Metadata-Version: 2.1\nName: forge-tiny\nVersion: {version}\n" + (f"Requires-Dist: {dependency}\n" if dependency else "")).encode(),
        f"{dist}/WHEEL": b"Wheel-Version: 1.0\nGenerator: forge-offline-test\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
    }
    record = io.StringIO(newline="")
    writer = csv.writer(record, lineterminator="\n")
    for name, data in files.items():
        encoded = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).decode().rstrip("=")
        writer.writerow([name, "sha256=" + encoded, len(data)])
    writer.writerow([f"{dist}/RECORD", "", ""])
    files[f"{dist}/RECORD"] = record.getvalue().encode()
    path = directory / f"forge_tiny-{version}-py3-none-any.whl"
    with zipfile.ZipFile(path, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return path


class UnitTests(unittest.TestCase):
    def test_paths_and_reserved_ids(self):
        for path in ["relative", str(Path.cwd() / ".." / "escape")]:
            with self.assertRaises(manager.EnvError):
                manager.safe_path(path)
        for value in ["../escape", "x/y", "x\\y", "CON", "NUL", "x:ads", ""]:
            with self.assertRaises(manager.EnvError):
                manager.identifier(value)
        with self.assertRaises(manager.EnvError):
            manager.store(manager.REPO, True)

    def test_credentials_and_pip_settings_not_inherited(self):
        with mock.patch.dict(os.environ, {"AWS_SECRET_ACCESS_KEY": "CANARY", "PIP_INDEX_URL": "https://user:CANARY@example.invalid", "PYTHONPATH": "CANARY", "HF_TOKEN": "CANARY", "HTTP_PROXY": "CANARY"}):
            env = manager.child_env()
        self.assertNotIn("CANARY", json.dumps(env))
        self.assertEqual(env["OMP_NUM_THREADS"], "4")
        self.assertEqual(env["PYTHONHASHSEED"], "42")
        self.assertEqual(env["CUDA_VISIBLE_DEVICES"], "")

    def test_failures_and_timeouts_do_not_echo_secrets(self):
        with mock.patch.object(manager.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "CANARY", "https://user:CANARY@host")):
            with self.assertRaises(manager.EnvError) as ctx:
                manager.call(["python", "CANARY"], "pip")
        self.assertNotIn("CANARY", str(ctx.exception))
        with mock.patch.object(manager.subprocess, "run", side_effect=subprocess.TimeoutExpired("CANARY", 1)):
            with self.assertRaises(manager.EnvError) as ctx:
                manager.call(["CANARY"], "pip")
        self.assertNotIn("CANARY", str(ctx.exception))

    def test_index_and_requirement_injection(self):
        for url in ["http://pypi.org/simple", "https://user:CANARY@example.org/simple", "https://pypi.org/simple?token=CANARY"]:
            with self.assertRaises(manager.EnvError):
                manager.index_url(url)
        for value in ["--index-url=https://bad", "thing @ https://bad", "-r file", "thing;python_version>'3'", "x\n--extra-index-url=x"]:
            self.assertIsNone(manager.SPEC.fullmatch(value))
        self.assertIsNotNone(manager.SPEC.fullmatch("numpy>=1.26,<3"))

    def test_process_uses_argv_without_shell(self):
        with mock.patch.object(manager.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "ok", "")) as launch:
            self.assertEqual(manager.call(["python with spaces", "-c", "x;echo CANARY"], "test"), "ok")
        self.assertEqual(launch.call_args.args[0], ["python with spaces", "-c", "x;echo CANARY"])
        self.assertNotIn("shell", launch.call_args.kwargs)

    def test_mutation_lock_and_nonempty_store(self):
        with tempfile.TemporaryDirectory() as temp:
            root = manager.store(Path(temp) / "store", True)
            with manager.mutation(root):
                with self.assertRaises(manager.EnvError):
                    with manager.mutation(root):
                        pass
            self.assertFalse((root / ".mutation.lock").exists())
            (Path(temp) / "unrelated.txt").write_text("preserve")
            with self.assertRaises(manager.EnvError):
                manager.store(Path(temp), True)

    def test_link_and_junction_rejection(self):
        with mock.patch.object(Path, "is_symlink", return_value=True):
            with self.assertRaises(manager.EnvError):
                manager.safe_path(Path.cwd() / "store")
        if hasattr(Path, "is_junction"):
            with mock.patch.object(Path, "is_junction", return_value=True):
                with self.assertRaises(manager.EnvError):
                    manager.safe_path(Path.cwd() / "store")

    def test_interpreter_matrix_and_no_gpu_default(self):
        for target in [{"implementation": "cpython", "version": [3, 13, 1], "platform": "win-amd64"}, {"implementation": "cpython", "version": [3, 12, 1], "platform": "macosx-14"}]:
            with mock.patch.object(manager, "call", return_value=json.dumps(target)):
                with self.assertRaises(manager.EnvError):
                    manager.probe(Path(sys.executable))
        args = manager.parser().parse_args(["prepare", "--root", str(Path.cwd()), "--profile", "text", "--version", "v1", "--python", sys.executable, "--wheelhouse", str(Path.cwd())])
        self.assertFalse(args.gpu)

    def test_seed_validation_is_bounded(self):
        self.assertEqual(manager.uint32("42"), 42)
        self.assertEqual(manager.uint32("4294967295"), 4294967295)
        for value in ["-1", "4294967296", "nope"]:
            with self.assertRaises(manager.argparse.ArgumentTypeError):
                manager.uint32(value)

    def test_local_wheel_direct_reference_rejected_before_resolution(self):
        with tempfile.TemporaryDirectory() as temp:
            path = wheel(Path(temp), dependency="evil @ https://example.invalid/CANARY.whl")
            with self.assertRaises(manager.EnvError) as ctx:
                manager.wheel_record(path)
            self.assertNotIn("CANARY", str(ctx.exception))


@unittest.skipUnless(sys.version_info[:2] in {(3, 11), (3, 12)}, "Real lifecycle test requires CPython3.11/3.12")
class LifecycleTests(unittest.TestCase):
    def test_real_offline_lifecycle_and_fail_closed(self):
        with tempfile.TemporaryDirectory(prefix="forge training test ") as temp:
            base = Path(temp)
            root = base / "store"
            wheels = base / "wheels"
            wheels.mkdir()
            wheel(wheels)
            requirement = base / "requirements.in"
            requirement.write_text("forge-tiny==1.0\n", encoding="utf-8")

            def cli(command, *args, success=True):
                result = subprocess.run([sys.executable, str(CLI), command, "--root", str(root), "--profile", "tabular", *map(str, args)], capture_output=True, text=True, timeout=180)
                if success:
                    self.assertEqual(result.returncode, 0, result.stderr)
                else:
                    self.assertNotEqual(result.returncode, 0)
                return result

            prep = ["--python", sys.executable, "--wheelhouse", wheels, "--requirements", requirement, "--smoke-import", "forge_tiny"]
            cli("prepare", "--version", "v1", *prep)
            first = root / "tabular/versions/v1"
            lock1 = (first / "requirements.lock").read_bytes()
            self.assertIn(b"forge-tiny==1.0 --hash=sha256:", lock1)
            self.assertFalse((root / "tabular/active.json").exists())
            cli("activate", "--version", "v1", success=False)
            cli("create", "--version", "v1")
            cli("create", "--version", "v1", success=False)
            cli("verify", "--version", "v1")
            cli("activate", "--version", "v1")
            script = base / "inspect job.py"
            script.write_text("import forge_tiny,os,json\nprint(json.dumps(dict(version=forge_tiny.VALUE,seed=os.environ['FORGE_TRAINING_SEED'],cpus=os.environ['OMP_NUM_THREADS'],gpu=os.environ.get('CUDA_VISIBLE_DEVICES'),secret=os.environ.get('FORGE_CANARY_SECRET'),argument=__import__('sys').argv[1:])))\n", encoding="utf-8")
            with mock.patch.dict(os.environ, {"FORGE_CANARY_SECRET": "CANARY"}):
                output = json.loads(cli("run", "--script", script, "--", "argument;not a shell").stdout)
            self.assertEqual(output, {"version": "1.0", "seed": "42", "cpus": "4", "gpu": "", "secret": None, "argument": ["argument;not a shell"]})
            wheel(wheels, "2.0")
            requirement.write_text("forge-tiny==2.0\n", encoding="utf-8")
            cli("upgrade", "--from", "v1", "--version", "v2", *prep)
            self.assertEqual(manager.pointer(root, "tabular")["current"], "v1")
            meta2 = manager.read_json(root / "tabular/versions/v2/metadata.json")
            self.assertEqual(meta2["upgrade_from"]["lock_sha256"], hashlib.sha256(lock1).hexdigest())
            # An already running job keeps v1 while the pointer changes to v2.
            holding_script = base / "holding job.py"
            ready, release = base / "job-ready", base / "job-release"
            holding_script.write_text("import pathlib,sys,time,forge_tiny\nready,release=map(pathlib.Path,sys.argv[1:])\nready.write_text('ready')\ndeadline=time.monotonic()+40\nwhile not release.exists() and time.monotonic()<deadline: time.sleep(0.05)\nprint(forge_tiny.VALUE)\n", encoding="utf-8")
            with subprocess.Popen([sys.executable, str(CLI), "run", "--root", str(root), "--profile", "tabular", "--script", str(holding_script), "--", str(ready), str(release)], stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True) as job:
                try:
                    deadline = time.monotonic() + 30
                    while not ready.exists() and time.monotonic() < deadline and job.poll() is None:
                        time.sleep(0.05)
                    self.assertTrue(ready.exists(), "Pinned job did not start")
                    cli("activate", "--version", "v2")
                finally:
                    release.write_text("release", encoding="utf-8")
                    output, errors = job.communicate(timeout=30)
                self.assertEqual(job.returncode, 0, errors)
                self.assertEqual(output.strip(), "1.0")
            self.assertEqual(json.loads(cli("run", "--script", script).stdout)["version"], "2.0")
            self.assertEqual(json.loads(cli("run", "--version", "v1", "--script", script).stdout)["version"], "1.0")
            cli("rollback")
            self.assertEqual(manager.pointer(root, "tabular")["current"], "v1")
            # Duplicate ID and failed resolve preserve active and previous versions.
            cli("prepare", "--version", "v1", *prep, success=False)
            requirement.write_text("missing-forge-test-package==9.0\n", encoding="utf-8")
            cli("upgrade", "--from", "v1", "--version", "missing", *prep, success=False)
            self.assertEqual(manager.read_json(root / "tabular/versions/missing/metadata.json")["state"], "FAILED_PREPARE")
            self.assertEqual(manager.pointer(root, "tabular")["current"], "v1")
            # Create failure is durable and cannot activate.
            requirement.write_text("forge-tiny==1.0\n", encoding="utf-8")
            cli("prepare", "--version", "bad-import", *prep, "--smoke-import", "missing_forge_module")
            cli("create", "--version", "bad-import", success=False)
            self.assertEqual(manager.read_json(root / "tabular/versions/bad-import/metadata.json")["state"], "FAILED_CREATE")
            cli("activate", "--version", "bad-import", success=False)
            # Tampered lock and wheel block verify/activation/rollback.
            second = root / "tabular/versions/v2"
            with (second / "requirements.lock").open("a") as stream:
                stream.write("bad\n")
            cli("rollback", success=False)
            self.assertEqual(manager.pointer(root, "tabular")["current"], "v1")
            artifact = next((first / "wheels").glob("*.whl"))
            with artifact.open("ab") as stream:
                stream.write(b"tamper")
            cli("verify", "--version", "v1", success=False)
            cli("run", "--script", script, success=False)


if __name__ == "__main__":
    unittest.main(verbosity=2)
