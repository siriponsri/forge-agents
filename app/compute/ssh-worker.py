"""FORGE owned Linux/POSIX Python worker. Request data arrives on stdin, never a shell command."""
import base64
import hashlib
import json
import os
import pathlib
import signal
import socket
import subprocess
import sys
import time
import uuid


def atomic(file, value):
    tmp = file.with_suffix('.tmp.' + str(os.getpid()))
    with tmp.open('w', encoding='utf8') as out:
        json.dump(value, out)
        out.flush()
        os.fsync(out.fileno())
    os.replace(tmp, file)


def birth(pid):
    try:
        # comm can contain spaces and parentheses: parse from its final close parenthesis.
        return pathlib.Path('/proc/%d/stat' % pid).read_text().rsplit(')', 1)[1].split()[19]
    except (OSError, IndexError):
        return None


def observe(directory):
    record = json.loads((directory / 'state.json').read_text())
    if record['status'] == 'running' and (not record.get('birth') or birth(record['pid']) != record.get('birth')):
        record['status'] = 'unknown'
    log = directory / 'output.log'
    if log.exists():
        with log.open('rb') as source:
            source.seek(max(0, log.stat().st_size - 200000))
            record['logs'] = source.read().decode('utf8', errors='replace')
    return record


def run(directory):
    req = json.loads((directory / 'request.json').read_text())
    state = {'status': 'starting', 'owner': req['owner'], 'jobId': req['jobId']}
    try:
        env = {k: v for k, v in os.environ.items() if k in ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR']}
        if req.get('checkpointPath'):
            env['FORGE_CHECKPOINT_PATH'] = req['checkpointPath']
        with (directory / 'output.log').open('ab', buffering=0) as log:
            child = subprocess.Popen([sys.executable, '-u', str(directory / 'source.py')], cwd=req['workspace'], env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
            state.update(status='running', pid=child.pid, birth=birth(child.pid), startedAt=time.time())
            atomic(directory / 'state.json', state)
            deadline = time.monotonic() + req['limitSeconds']
            stop_at = None
            timed_out = False
            while child.poll() is None:
                cancel = (directory / 'cancel').exists()
                timed_out = time.monotonic() >= deadline
                if (cancel or timed_out) and stop_at is None:
                    stop_at = time.monotonic()
                    if state['birth'] and birth(child.pid) == state['birth']:
                        os.killpg(child.pid, signal.SIGTERM)
                if stop_at and time.monotonic() - stop_at > 3 and state['birth'] and birth(child.pid) == state['birth']:
                    os.killpg(child.pid, signal.SIGKILL)
                time.sleep(.05)
            code = child.returncode
            state.update(status='stopped' if (directory / 'cancel').exists() else 'failed' if timed_out or code else 'completed', exitCode=code, finishedAt=time.time(), timedOut=timed_out)
    except BaseException as exc:
        state.update(status='failed', error=type(exc).__name__)
    atomic(directory / 'state.json', state)


def machine_identity():
    machine = pathlib.Path('/etc/machine-id').read_text().strip()
    return hashlib.sha256(machine.encode()).hexdigest()


def dispatch(req):
    identity = machine_identity()
    if req['action'] == 'health':
        return {'machineId': identity, 'hostname': socket.gethostname(), 'python': sys.version.split()[0], 'platform': sys.platform}
    if req.get('expectedMachineId') != identity:
        raise ValueError('HOST_IDENTITY_MISMATCH')
    job_id = str(uuid.UUID(req['jobId']))
    uuid.UUID(req['owner'])
    directory = pathlib.Path.home() / '.forge' / 'attempts' / job_id
    if req['action'] == 'start':
        directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            directory.mkdir(mode=0o700)
        except FileExistsError:
            old = json.loads((directory / 'request.json').read_text())
            if old['owner'] != req['owner']:
                raise ValueError('OWNERSHIP_MISMATCH')
            return observe(directory)
        workspace = pathlib.Path(req['workspace']).resolve(strict=True)
        if not workspace.is_dir():
            raise ValueError('WORKSPACE_MISSING')
        req['workspace'] = str(workspace)
        atomic(directory / 'request.json', req)
        (directory / 'source.py').write_text(req['code'], encoding='utf8')
        (directory / 'worker.py').write_text(req['workerSource'], encoding='utf8')
        atomic(directory / 'state.json', {'status': 'starting', 'owner': req['owner'], 'jobId': job_id})
        with (directory / 'supervisor.log').open('ab') as log:
            subprocess.Popen([sys.executable, str(directory / 'worker.py'), 'run', str(directory)], stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True, close_fds=True)
        return observe(directory)
    if not directory.exists() and req['action'] == 'stop':
        # A cancellation arriving before dispatch leaves a durable tombstone.
        directory.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        try:
            directory.mkdir(mode=0o700)
            atomic(directory / 'request.json', req)
            atomic(directory / 'state.json', {'status': 'stopped', 'owner': req['owner'], 'jobId': job_id})
        except FileExistsError:
            pass
    if not directory.exists():
        return {'status': 'unknown', 'reason': 'No durable remote receipt; no redispatch'}
    record = observe(directory)
    if record.get('owner') != req['owner']:
        raise ValueError('OWNERSHIP_MISMATCH')
    if req['action'] == 'stop' and record['status'] in ['running', 'starting']:
        # Supervisor owns process signalling and birth checks. A stale PID is never killed.
        (directory / 'cancel').touch()
        record['status'] = 'stopping'
    return record


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'run':
        run(pathlib.Path(sys.argv[2]))
    else:
        try:
            print(json.dumps(dispatch(json.load(sys.stdin))))
        except BaseException as exc:
            print(json.dumps({'error': str(exc) if str(exc) in ['HOST_IDENTITY_MISMATCH', 'OWNERSHIP_MISMATCH'] else type(exc).__name__}))
            sys.exit(1)
