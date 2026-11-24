"""FORGE original bounded JSON linear predictor; no pickle, arbitrary code or training.

LitServe supplies the real REST + MCP transports. Fixture-labelled weights remain
engineering evidence, never an owner model or quality claim.
"""
import hashlib
import json
import math
import os
from pathlib import Path
import signal
import sys
import threading

import litserve as ls
from litserve.mcp import MCP
from pydantic import BaseModel, Field


class PredictRequest(BaseModel):
    inputs: list[float] = Field(min_length=1, max_length=10000)


class LinearAPI(ls.LitAPI):
    def __init__(self, manifest):
        self.manifest = manifest
        super().__init__(api_path="/predict", mcp=MCP(
            name="forge_predict", description="Predict using the selected verified JSON linear weights and standardization artifacts"))

    def setup(self, device):
        loaded = {}
        values = {}
        for kind in ("model", "preprocessor"):
            ref = self.manifest["binding"][kind]
            data = Path(self.manifest[kind + "Path"]).read_bytes()
            if hashlib.sha256(data).hexdigest() != ref["sha256"]:
                raise ValueError(kind + " checksum mismatch before loading")
            values[kind] = json.loads(data)
            loaded[kind] = {k: ref[k] for k in ("artifactId", "revision", "sha256", "bytes")}
        self.model, self.preprocessor = values["model"], values["preprocessor"]
        self.evidence = {"kind": "owned-loader-observation", "deploymentId": self.manifest["deploymentId"],
                         "instanceId": self.manifest["instanceId"], "binding": loaded,
                         "loader": "forge.linear.v1", "engineeringFixture": self.model.get("engineeringFixture", False),
                         "workerPid": os.getpid()}
        evidence_path = Path(self.manifest["evidencePath"])
        staging = evidence_path.with_suffix(".tmp")
        staging.write_text(json.dumps(self.evidence), encoding="utf-8")
        staging.replace(evidence_path)

    def decode_request(self, request: PredictRequest):
        inputs = request.inputs
        if len(inputs) != len(self.model["weights"]) or not all(math.isfinite(x) for x in inputs):
            from fastapi import HTTPException
            raise HTTPException(422, "inputs must be finite and match the selected model feature count")
        return inputs

    def predict(self, inputs):
        standardized = [(x - mean) / scale for x, mean, scale in zip(inputs, self.preprocessor["mean"], self.preprocessor["scale"])]
        value = sum(w * x for w, x in zip(self.model["weights"], standardized)) + self.model["bias"]
        if not math.isfinite(value):
            raise ValueError("Prediction overflow; choose bounded finite inputs")
        return {"prediction": value, "forgeEvidence": self.evidence}


def own_windows_process_tree():
    """Kernel closes the entire owned job when this runner exits, including on crash."""
    import ctypes
    from ctypes import wintypes

    class BasicLimits(ctypes.Structure):
        _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                    ("flags", wintypes.DWORD), ("minimum_ws", ctypes.c_size_t),
                    ("maximum_ws", ctypes.c_size_t), ("active_processes", wintypes.DWORD),
                    ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD),
                    ("scheduling", wintypes.DWORD)]

    class IOCounters(ctypes.Structure):
        _fields_ = [(key, ctypes.c_uint64) for key in ("read_ops", "write_ops", "other_ops", "read_bytes", "write_bytes", "other_bytes")]

    class ExtendedLimits(ctypes.Structure):
        _fields_ = [("basic", BasicLimits), ("io", IOCounters), ("process_memory", ctypes.c_size_t),
                    ("job_memory", ctypes.c_size_t), ("peak_process", ctypes.c_size_t), ("peak_job", ctypes.c_size_t)]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    kernel.CreateJobObjectW.restype = wintypes.HANDLE
    kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
    kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    kernel.GetCurrentProcess.restype = wintypes.HANDLE
    job = kernel.CreateJobObjectW(None, None)
    limits = ExtendedLimits()
    limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
    if not job or not kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)) or not kernel.AssignProcessToJobObject(job, kernel.GetCurrentProcess()):
        raise ctypes.WinError(ctypes.get_last_error())
    # This non-inherited kernel handle stays open only in this runner. All spawned
    # inference/manager processes inherit membership, never ownership of the handle.
    return job


def main():
    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    owned_job = own_windows_process_tree() if os.name == "nt" else None

    def stop_on_owner_exit():
        if os.name == "nt":
            import ctypes
            from ctypes import wintypes
            kernel = ctypes.WinDLL("kernel32", use_last_error=True)
            kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
            kernel.OpenProcess.restype = wintypes.HANDLE
            kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
            kernel.CloseHandle.argtypes = [wintypes.HANDLE]
            # Open once at launch and wait on that process object. PID reuse
            # cannot attach this watcher to a replacement process afterward.
            owner = kernel.OpenProcess(0x00100000, False, manifest["ownerPid"])
            if owner:
                kernel.WaitForSingleObject(owner, 0xFFFFFFFF)
                kernel.CloseHandle(owner)
            # The job handle closes on exit and the kernel stops every child.
            os._exit(0)
        else:
            os.read(sys.stdin.fileno(), 1)
            os.killpg(os.getpgrp(), signal.SIGTERM)

    threading.Thread(target=stop_on_owner_exit, daemon=True).start()
    server = ls.LitServer(LinearAPI(manifest), accelerator="cpu", devices=1, workers_per_device=1)

    @server.app.get("/forge/evidence")
    def evidence():
        return json.loads(Path(manifest["evidencePath"]).read_text(encoding="utf-8"))

    # Never let the upstream 0.0.0.0 default expose an owner model publicly.
    server.run(host="127.0.0.1", port=manifest["port"], num_api_servers=1, generate_client_file=False)


if __name__ == "__main__":
    main()
