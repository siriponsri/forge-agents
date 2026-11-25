"""Bounded Mission verifier. Reuses FORGE's existing owned process-tree driver.
No package scripts, shell, provider runtime, dependency install or credentials.
Process ownership is not an OS sandbox; only Owner-reviewed code may run.
"""
import json
import os
from pathlib import Path
import runpy
import sys
import tempfile
import threading
import time


def main():
    request = json.loads(sys.stdin.buffer.readline(32768))
    tree_types = runpy.run_path(str(Path(__file__).resolve().parents[1] / 'jobs' / 'runner.py'))
    stopped = threading.Event()

    def watch_pipe():
        # Raw OS read avoids holding Python's buffered-stdin lock at shutdown.
        os.read(sys.stdin.fileno(), 1)
        stopped.set()

    threading.Thread(target=watch_pipe, daemon=True).start()
    with tempfile.TemporaryFile() as log:
        tree = tree_types['WindowsTree' if os.name == 'nt' else 'PosixTree'](
            [request['executable'], *request['args']], request['cwd'], log)
        deadline = time.monotonic() + request['maxMs'] / 1000
        reason = None
        try:
            while tree.poll() is None and not stopped.wait(.025):
                if time.monotonic() >= deadline:
                    reason = 'timeout'
                    break
                if os.fstat(log.fileno()).st_size > 262144:
                    reason = 'output-limit'
                    break
            code = tree.poll()
        finally:
            tree.cleanup()
        log.seek(0)
        output = log.read(262145)
        truncated = len(output) > 262144
        result = {'status': 'PASSED' if code == 0 and not reason and not stopped.is_set() and not truncated else 'FAILED',
                  'code': code, 'timedOut': reason == 'timeout', 'truncated': truncated,
                  'stopped': stopped.is_set(), 'treeCleaned': True,
                  'ownership': 'Windows JobObject; full owned tree drained' if os.name == 'nt' else 'POSIX owned group; intentional group escapes excluded',
                  'log': output[:262144].decode('utf-8', errors='replace')}
        print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
