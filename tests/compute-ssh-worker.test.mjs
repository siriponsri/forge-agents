import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('SSH Python worker contract fixture: durable actual subprocess, exclusive attempt, cancellation tombstone and PID ownership',async()=>{
  // Portable harness: machine/home identity and /proc birth are simulated, never a real SSH host.
  // The first part executes the actual detached supervisor and a harmless Python child.
  const harness=String.raw`
import importlib.util, pathlib, tempfile, uuid, json, time, sys, shutil
sys.dont_write_bytecode=True
source=pathlib.Path(sys.argv[1])
spec=importlib.util.spec_from_file_location('forge_worker_fixture',source)
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)
root=pathlib.Path(tempfile.mkdtemp(prefix='forge-ssh-worker-fixture-'))
original_home=pathlib.Path.home
pathlib.Path.home=staticmethod(lambda:root)
w.machine_identity=lambda:'a'*64
workspace=root/'workspace with spaces'
workspace.mkdir()
req={'action':'start','jobId':str(uuid.uuid4()),'owner':str(uuid.uuid4()),'workspace':str(workspace),'expectedMachineId':'a'*64,'code':"print('actual detached Python fixture')",'workerSource':source.read_text(),'limitSeconds':3}
try:
    initial=w.dispatch(req)
    directory=root/'.forge'/'attempts'/req['jobId']
    for _ in range(150):
        observed=w.dispatch(dict(req,action='status'))
        if observed['status'] in ['completed','failed']:break
        time.sleep(.04)
    assert observed['status']=='completed',observed
    assert 'actual detached Python fixture' in observed['logs']
    assert w.dispatch(req)['status']=='completed'
    try:w.dispatch(dict(req,owner=str(uuid.uuid4())))
    except ValueError as e:assert str(e)=='OWNERSHIP_MISMATCH'
    else:raise AssertionError('different owner accepted')
    try:w.dispatch(dict(req,expectedMachineId='b'*64))
    except ValueError as e:assert str(e)=='HOST_IDENTITY_MISMATCH'
    else:raise AssertionError('different host accepted')
    early=dict(req,jobId=str(uuid.uuid4()),action='stop')
    assert w.dispatch(early)['status']=='stopped'
    assert w.dispatch(dict(early,action='start'))['status']=='stopped'
    # Simulate a PID reused by another process: observation is unknown and no signal is sent.
    fixture=root/'ownership';fixture.mkdir()
    w.atomic(fixture/'request.json',req)
    w.atomic(fixture/'state.json',{'status':'running','pid':123456,'birth':'old','owner':req['owner']})
    w.birth=lambda pid:'new'
    assert w.observe(fixture)['status']=='unknown'
    class Child:
        pid=123456
        returncode=0
        n=0
        def poll(self):
            self.n+=1
            return None if self.n<3 else 0
    original_spawn=w.subprocess.Popen
    calls=[]
    def fake_spawn(*args,**kwargs):
        assert kwargs['start_new_session'] is True
        assert set(kwargs['env']).issubset({'PATH','HOME','LANG','LC_ALL','TMPDIR','FORGE_CHECKPOINT_PATH'})
        return Child()
    w.subprocess.Popen=fake_spawn
    w.os.killpg=lambda pid,sig:calls.append(pid)
    (fixture/'cancel').touch()
    w.birth=lambda pid:'owned'
    w.run(fixture)
    assert calls==[123456],calls
    assert json.loads((fixture/'state.json').read_text())['status']=='stopped'
    calls.clear()
    births=iter(['owned','reused','reused','reused'])
    w.birth=lambda pid:next(births,'reused')
    w.run(fixture)
    assert calls==[],calls
    w.subprocess.Popen=original_spawn
    print(json.dumps({'status':'passed','scope':'labelled local Python supervisor and simulated SSH/PID contract; no remote authentication'}))
finally:
    pathlib.Path.home=original_home
    shutil.rmtree(root)
`;
  const result=await new Promise((resolve,reject)=>{const p=spawn('python',['-c',harness,fileURLToPath(new URL('../app/compute/ssh-worker.py',import.meta.url))],{windowsHide:true,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',b=>stdout+=b);p.stderr.on('data',b=>stderr+=b);p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));});
  assert.equal(result.code,0,result.stderr);assert.equal(JSON.parse(result.stdout).status,'passed');
});
