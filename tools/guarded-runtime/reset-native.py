"""Reset only previously patched cache files, refusing divergent work."""
import pathlib, sys, json, tarfile, hashlib
cache = pathlib.Path(sys.argv[1]).resolve()
report = json.loads((cache/'patch-report.json').read_text())
sha = lambda b: hashlib.sha256(b.replace(b'\r\n',b'\n')).hexdigest()
for source in ['t3','opencode']:
    changes = {c['file']:c for c in report['changes'] if c['source']==source and c['before']}
    pending=[]
    with tarfile.open(cache/(source+'.tgz')) as tar:
        for m in tar:
            rel='/'.join(m.name.split('/')[1:])
            if rel not in changes: continue
            target=(cache/source/rel).resolve()
            if not target.is_relative_to(cache/source) or not m.isfile(): raise ValueError('UNSAFE_CACHE')
            before=tar.extractfile(m).read()
            if sha(before)!=changes[rel]['before'] or sha(target.read_bytes())!=changes[rel]['after']: raise ValueError('DIVERGENT_CACHE: '+rel)
            pending.append((target,before))
    if len(pending)!=len(changes):raise ValueError('MISSING_CACHE_PREIMAGE')
    for target,before in pending:target.write_bytes(before)
