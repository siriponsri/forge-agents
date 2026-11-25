"""Verify decoded media, actual effect receipts, qualifications, hashes and privacy."""
import hashlib
import json
import pathlib
import re
import subprocess
from PIL import Image, ImageSequence

ROOT = pathlib.Path(__file__).resolve().parents[2]
MEDIA = ROOT / 'docs' / 'media'
manifest = json.loads((MEDIA / 'manifest.json').read_text(encoding='utf-8'))
assert manifest['status'] == 'PREPARED_MEDIA_NOT_FINAL_RELEASE_VERIFICATION'
assert re.fullmatch('[a-f0-9]{40}', manifest['preparedRevision'])
assert manifest['sourceDirty'] is False
assert manifest['providerCalls'] == 0
assert manifest['homeUat'] == 'HOME_UAT_NOT_RUN'
assert manifest['browserErrors'] == []
assert manifest['receipts']['health'] == 'ready'
assert manifest['receipts']['delivery']['verified']
assert manifest['receipts']['tests'][-1]['status'] == 'PASSED'
assert manifest['receipts']['tests'][-1]['treeCleaned'] is True
assert manifest['receipts']['sheet']['savedTextVerified']
assert manifest['receipts']['doc']['reopened']
assert manifest['receipts']['memory']['explicitGrantEvent']
assert manifest['receipts']['compute']['outputVerified']
assert manifest['receipts']['restart']['savedOfficeRevisionsVerified']
assert manifest['receipts']['graph']['toolResultObserved'] is False
assert manifest['receipts']['graph']['draftPreserved']
assert manifest['receipts']['provider']['calls'] == 0
assert all(manifest['receipts']['cleanup'].values())
assert manifest['build']['mode'] == 'production'
report = manifest['receipts']['report']
if report['status'] == 'ready':
    assert {'pdf', 'docx'} <= {a['kind'] for a in report['outputs']}
    assert all(a['bytes'] > 0 and len(a['sha256']) == 64 for a in report['outputs'])
else:
    assert report['status'] == 'NOT_RUN' and report['gap']

results = []
for entry in manifest['files']:
    file = MEDIA / entry['filename']
    assert file.resolve().is_relative_to(MEDIA.resolve())
    data = file.read_bytes()
    assert len(data) == entry['bytes']
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], entry['filename']
    if file.suffix in {'.png', '.gif'}:
        with Image.open(file) as image:
            width, height = image.size
            frames = image.n_frames
            for frame in ImageSequence.Iterator(image):
                frame.load()
            assert width >= 390 and height >= 650, entry['filename']
            if file.suffix == '.gif':
                assert frames > 5, entry['filename']
                assert len(data) <= 8 * 1024 * 1024, entry['filename']
            results.append({'filename': entry['filename'], 'width': width, 'height': height, 'frames': frames, 'decoded': True})
    elif file.suffix == '.webm':
        subprocess.run(['ffmpeg', '-v', 'error', '-i', str(file), '-f', 'null', '-'], check=True)
        results.append({'filename': entry['filename'], 'decoded': True})

for shot in manifest['screenshots']:
    assert shot['alt'] and shot['caption'] and shot['qualification'] and shot['source']
    if any(word in shot['filename'] for word in ['mission', 'delivery', 'plan', 'workspace', 'tool-evidence', 'recovery', 'overview-mobile', 'chat.']):
        assert 'inject' in (shot['qualification'] + shot['alt']).lower(), shot['filename']
for clip in manifest['walkthroughs']:
    assert clip['steps'] and clip['qualification'] and clip['alt']
    assert clip['source'] == 'sources/walkthroughs.webm'
    assert clip['endSeconds'] > clip['startSeconds'] >= 0
    assert '2x' in clip['editing'] and 'No frame interpolation' in clip['editing']

# Review machine-readable public text, never runtime private state. Also compare
# decoded frames manually; binary-string checks alone cannot audit raster text.
for file in MEDIA.rglob('*'):
    if file.suffix in {'.json', '.md', '.svg', '.mmd', '.txt'}:
        text = file.read_text(encoding='utf-8')
        assert not re.search(r'(?i)(?:[A-Z]:[\\/]+Users[\\/]|/Users/|/home/|Bearer\s+[A-Za-z0-9._-]{20,}|(?:sk|ghp)[_-][A-Za-z0-9]{20,}|mcp-bearer\.secret|device_code=|access_token=)', text), file.name

for file in [MEDIA / 'README.md', ROOT / 'docs/worker-readme-media.md', ROOT / 'tools/readme-media/README.md']:
    for target in re.findall(r'\]\(([^)]+)\)', file.read_text(encoding='utf-8')):
        assert not target.startswith(('http:', 'https:')), 'Media docs require no external hosting'
        assert (file.parent / target.split('#')[0]).exists(), (file.name, target)

result = {'result': 'PASSED', 'preparedRevision': manifest['preparedRevision'],
          'checks': ['all public media SHA-256 and sizes', 'all PNG/GIF frames decoded',
                     'source WebM full decode', 'GIF <=8 MiB', 'visible fixture qualifications + alt/caption records',
                     'real local effect receipts and restart', 'owned service/browser/fixture cleanup', 'public text privacy scan', 'all local media/tool/handoff Markdown links'],
          'visualReview': 'Separate required human/agent visual review; binary scans cannot audit raster text.',
          'media': results, 'homeUat': 'HOME_UAT_NOT_RUN'}
(MEDIA / 'verification.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'result': 'PASSED', 'decodedMedia': len(results)}))
