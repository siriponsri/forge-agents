"""Private notebook tree owner. Standard library only, no serving dependency.
Windows workers join a kill-on-close JobObject while suspended, before executing.
POSIX owns a process group via pipe EOF; deliberate group escapes are excluded.
Process lifecycle ownership is not a sandbox for hostile user Python code.
"""
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time


class WindowsTree:
    def __init__(self, args, workspace, log):
        import ctypes as c
        from ctypes import wintypes as w
        self.c, self.w = c, w
        k = self.k = c.WinDLL('kernel32', use_last_error=True)
        class Basic(c.Structure):
            _fields_ = [('pt', c.c_int64), ('jt', c.c_int64), ('flags', w.DWORD), ('min_ws', c.c_size_t), ('max_ws', c.c_size_t), ('active', w.DWORD), ('affinity', c.c_size_t), ('priority', w.DWORD), ('scheduling', w.DWORD)]
        class IO(c.Structure):
            _fields_ = [(n, c.c_uint64) for n in ('ro', 'wo', 'oo', 'rb', 'wb', 'ob')]
        class Limits(c.Structure):
            _fields_ = [('basic', Basic), ('io', IO), ('pm', c.c_size_t), ('jm', c.c_size_t), ('pp', c.c_size_t), ('pj', c.c_size_t)]
        class Startup(c.Structure):
            _fields_ = [('cb', w.DWORD), ('reserved', w.LPWSTR), ('desktop', w.LPWSTR), ('title', w.LPWSTR), ('x', w.DWORD), ('y', w.DWORD), ('xs', w.DWORD), ('ys', w.DWORD), ('xc', w.DWORD), ('yc', w.DWORD), ('fill', w.DWORD), ('flags', w.DWORD), ('show', w.WORD), ('rs', w.WORD), ('r2', c.c_void_p), ('stdin', w.HANDLE), ('stdout', w.HANDLE), ('stderr', w.HANDLE)]
        class Process(c.Structure):
            _fields_ = [('process', w.HANDLE), ('thread', w.HANDLE), ('pid', w.DWORD), ('tid', w.DWORD)]
        class Accounting(c.Structure):
            _fields_ = [('ut', c.c_int64), ('kt', c.c_int64), ('put', c.c_int64), ('pkt', c.c_int64), ('faults', w.DWORD), ('total', w.DWORD), ('active', w.DWORD), ('terminated', w.DWORD)]
        self.Accounting = Accounting
        k.CreateJobObjectW.argtypes = [c.c_void_p, w.LPCWSTR]; k.CreateJobObjectW.restype = w.HANDLE
        k.SetInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD]
        k.AssignProcessToJobObject.argtypes = [w.HANDLE, w.HANDLE]
        k.TerminateJobObject.argtypes = [w.HANDLE, w.UINT]
        k.QueryInformationJobObject.argtypes = [w.HANDLE, c.c_int, c.c_void_p, w.DWORD, c.c_void_p]
        k.CloseHandle.argtypes = [w.HANDLE]; k.ResumeThread.argtypes = [w.HANDLE]
        k.GetCurrentProcess.restype = w.HANDLE
        k.TerminateProcess.argtypes = [w.HANDLE, w.UINT]
        k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]
        k.GetExitCodeProcess.argtypes = [w.HANDLE, c.POINTER(w.DWORD)]
        k.CreateProcessW.argtypes = [w.LPCWSTR, w.LPWSTR, c.c_void_p, c.c_void_p, w.BOOL, w.DWORD, c.c_void_p, w.LPCWSTR, c.POINTER(Startup), c.POINTER(Process)]
        limits = Limits(); limits.basic.flags = 0x2000
        # Outer guard includes this supervisor, so even a wrapper crash between
        # CreateProcess(suspended) and inner-job assignment cannot leak a child.
        # Its handle is private/non-inherited and closes on supervisor death.
        self.guard = k.CreateJobObjectW(None, None)
        if not self.guard or not k.SetInformationJobObject(self.guard, 9, c.byref(limits), c.sizeof(limits)) or not k.AssignProcessToJobObject(self.guard, k.GetCurrentProcess()): raise c.WinError(c.get_last_error())
        self.job = k.CreateJobObjectW(None, None)
        if not self.job or not k.SetInformationJobObject(self.job, 9, c.byref(limits), c.sizeof(limits)): raise c.WinError(c.get_last_error())
        import msvcrt
        with open(os.devnull, 'rb') as null:
            handles = [msvcrt.get_osfhandle(f.fileno()) for f in (null, log)]
            for h in handles: os.set_handle_inheritable(h, True)
            si = Startup(); si.cb = c.sizeof(si); si.flags = 0x100; si.stdin, si.stdout, si.stderr = handles[0], handles[1], handles[1]
            self.pi = Process()
            try:
                if not k.CreateProcessW(args[0], c.create_unicode_buffer(subprocess.list2cmdline(args)), None, None, True, 0x08000004, None, workspace, c.byref(si), c.byref(self.pi)): raise c.WinError(c.get_last_error())
            finally:
                for h in handles: os.set_handle_inheritable(h, False)
        if not k.AssignProcessToJobObject(self.job, self.pi.process):
            err = c.get_last_error(); k.TerminateProcess(self.pi.process, 1); k.WaitForSingleObject(self.pi.process, 0xFFFFFFFF); raise c.WinError(err)
        if k.ResumeThread(self.pi.thread) == 0xFFFFFFFF:
            k.TerminateJobObject(self.job, 1); raise c.WinError(c.get_last_error())
        k.CloseHandle(self.pi.thread)

    def poll(self):
        if self.k.WaitForSingleObject(self.pi.process, 0) == 0x102: return None
        code = self.w.DWORD()
        if not self.k.GetExitCodeProcess(self.pi.process, self.c.byref(code)): raise self.c.WinError(self.c.get_last_error())
        return code.value

    def cleanup(self):
        if not self.k.TerminateJobObject(self.job, 1): raise self.c.WinError(self.c.get_last_error())
        while True:
            info = self.Accounting()
            if not self.k.QueryInformationJobObject(self.job, 1, self.c.byref(info), self.c.sizeof(info), None): raise self.c.WinError(self.c.get_last_error())
            if not info.active: break
            time.sleep(0.01)
        self.k.CloseHandle(self.pi.process); self.k.CloseHandle(self.job)


class PosixTree:
    def __init__(self, args, workspace, log):
        self.p = subprocess.Popen(args, cwd=workspace, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
    def poll(self): return self.p.poll()
    def cleanup(self):
        try: os.killpg(self.p.pid, signal.SIGKILL)
        except ProcessLookupError: pass
        self.p.wait()


def finish(m, status, code, reason):
    receipt = {'jobId': m['jobId'], 'status': status, 'exitCode': code, 'reason': reason, 'treeCleaned': True,
               'ownership': 'Windows JobObject; full owned tree drained' if os.name == 'nt' else 'POSIX owned process group; escaped groups excluded',
               'error': 'Python exited with code ' + str(code) if status == 'failed' else None}
    p = Path(m['receiptPath']); tmp = p.with_suffix('.tmp')
    tmp.write_text(json.dumps(receipt), encoding='utf-8'); tmp.replace(p)


def main():
    m = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
    stop = threading.Event()
    # No owner command (including EOF) means source must never launch.
    command = b''
    while not command.endswith(b'\n') and len(command) < 16:
        part = os.read(sys.stdin.fileno(), 1)
        if not part: break
        command += part
    if command != b'start\n': finish(m, 'stopped', None, 'stop'); return
    def pipe_watch():
        os.read(sys.stdin.fileno(), 1); stop.set()
    threading.Thread(target=pipe_watch, daemon=True).start()
    if os.name == 'nt':
        import ctypes as c
        from ctypes import wintypes as w
        k = c.WinDLL('kernel32', use_last_error=True)
        k.OpenProcess.argtypes = [w.DWORD, w.BOOL, w.DWORD]; k.OpenProcess.restype = w.HANDLE
        k.WaitForSingleObject.argtypes = [w.HANDLE, w.DWORD]; k.CloseHandle.argtypes = [w.HANDLE]
        owner = k.OpenProcess(0x00100000, False, m['ownerPid'])
        if not owner: stop.set()
        else:
            def watch_owner():
                k.WaitForSingleObject(owner, 0xFFFFFFFF); k.CloseHandle(owner); stop.set()
            threading.Thread(target=watch_owner, daemon=True).start()
    if stop.is_set(): finish(m, 'stopped', None, 'stop'); return
    reason = None
    with open(m['logPath'], 'ab', buffering=0) as log:
        tree = (WindowsTree if os.name == 'nt' else PosixTree)([sys.executable, '-u', m['script']], m['workspace'], log)
        deadline = time.monotonic() + m['limitSeconds']
        try:
            while tree.poll() is None and not stop.wait(0.025):
                if time.monotonic() >= deadline: reason = 'timeout'; stop.set()
            code = tree.poll()
        finally: tree.cleanup()
    finish(m, 'stopped' if stop.is_set() else ('completed' if code == 0 else 'failed'), code, reason or ('stop' if stop.is_set() else None))


if __name__ == '__main__':
    main()
