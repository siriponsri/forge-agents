"""Independent asset/link checks for the scoped FORGE documentation package."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import xml.etree.ElementTree as ET

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument('--baseline', default='4c944bd')
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'docs/brand'
evidence = json.loads((BRAND / 'evidence/exports.json').read_text(encoding='utf-8'))
checks = {'baseline': args.baseline, 'files': [], 'links': [], 'preserved': {}}
# Materialize this report's own linked target before validating documentation.
(BRAND / 'evidence/validation.json').write_text('{}\n', encoding='utf-8')

def sha(data):
    return hashlib.sha256(data).hexdigest()

for record in evidence['files']:
    file = BRAND / record['file']
    assert sha(file.read_bytes()) == record['sha256'], f'Hash mismatch: {file}'
    result = {'file': record['file'], 'sha256': record['sha256']}
    if file.suffix == '.svg':
        svg = ET.parse(file).getroot()
        title = svg.find('{http://www.w3.org/2000/svg}title')
        assert title is not None and title.text and svg.attrib.get('role') == 'img'
        ids = {el.attrib['id'] for el in svg.iter() if 'id' in el.attrib}
        assert set(svg.attrib['aria-labelledby'].split()) <= ids
        if '/exports/' in file.as_posix():
            allowed = {'svg', 'title', 'desc', 'g', 'path'}
            assert all(el.tag.rsplit('}', 1)[-1] in allowed for el in svg.iter())
            assert all(not key.endswith('href') for el in svg.iter() for key in el.attrib)
            assert 'http' not in file.read_text(encoding='utf-8').replace('http://www.w3.org/2000/svg', '')
            result['accessible_font_free_vector'] = True
    if file.suffix == '.png':
        with Image.open(file) as img:
            img.load()
            result['size'] = list(img.size)
            assert img.mode == 'RGBA', f'Expected RGBA: {file}'
            if '/exports/' in file.as_posix():
                alpha = img.getchannel('A')
                assert alpha.getextrema() == (0, 255), f'Expected transparent and opaque pixels: {file}'
                box = alpha.getbbox()
                assert box and box[0] > 0 and box[1] > 0 and box[2] < img.width and box[3] < img.height
                result['alpha_bounds'] = list(box)
                result['transparent_padding'] = True
    checks['files'].append(result)

layout = json.loads((BRAND / 'evidence/readme-layout.json').read_text(encoding='utf-8'))
for capture in layout['files']:
    assert sha((BRAND / 'evidence' / capture['file']).read_bytes()) == capture['sha256']

def lum(color):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return sum((v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) * w
               for v, w in zip(rgb, [.2126, .7152, .0722]))

for pair in evidence['contrast']:
    a, b = sorted([lum(pair['foreground']), lum(pair['background'])])
    ratio = (b + .05) / (a + .05)
    assert abs(ratio - pair['ratio']) < 1e-10 and ratio >= 7
checks['contrast'] = evidence['contrast']

for asset in evidence['exports']:
    file = BRAND / f"exports/forge-{asset['name']}-{asset['variant']}.png"
    with Image.open(file) as img:
        assert img.size == (asset['pngWidth'], asset['pngHeight'])

readme = (ROOT / 'README.md').read_text(encoding='utf-8')
baseline = subprocess.check_output(['git', 'show', f'{args.baseline}:README.md'], cwd=ROOT).decode('utf-8')
assert re.findall(r'<picture>[\s\S]*?</picture>', baseline) == re.findall(r'<picture>[\s\S]*?</picture>', readme)
checks['preserved']['diagram_picture_blocks_byte_identical'] = True
media = lambda s: re.findall(r'!\[[^\]]*\]\(docs/media/[^)]+\)', s)
assert media(readme) == media(baseline), 'Existing screenshot/GIF paths or alt labels changed'
checks['preserved']['existing_media_paths_and_alt_labels_identical'] = True
assert '2x speed' in readme and 'predetermined' in readme and 'injected' in readme
assert 'Apache-2.0' in readme and 'Legacy launchers retain their original meaning' in readme
assert 'role-session' in readme and 'pending' in readme and 'd928e9c' in readme
checks['readme_sha256'] = sha(readme.encode())
assert layout['readmeSHA256'] == checks['readme_sha256'], 'README layout captures need regeneration'
checks['readme_layout_variants'] = len(layout['variants'])

def anchor_set(source):
    anchors = set()
    for heading in re.findall(r'^#{1,6}\s+(.+)$', source, re.M):
        heading = heading.lower().strip()
        anchors.add(re.sub(r'[^\w\- ]', '', heading).replace(' ', '-'))
    return anchors

docs = [ROOT / 'README.md', BRAND / 'README.md', ROOT / 'docs/worker-readme-brand.md']
for doc in docs:
    text = doc.read_text(encoding='utf-8')
    refs = re.findall(r'(?:!?\[[^\]]*\]\()([^\s)]+)\)', text)
    refs += re.findall(r'(?:href|src|srcset)="([^"]+)"', text)
    for ref in refs:
        if re.match(r'^(?:https?:|mailto:)', ref):
            continue
        target, _, fragment = ref.partition('#')
        path = (doc.parent / target).resolve() if target else doc
        assert path.exists(), f'Broken link: {doc.relative_to(ROOT)} -> {ref}'
        if fragment and not fragment.startswith('gh-') and path.suffix == '.md':
            assert fragment in anchor_set(path.read_text(encoding='utf-8')), f'Unknown anchor: {ref}'
        checks['links'].append({'document': doc.relative_to(ROOT).as_posix(), 'target': ref})

checks['source_sha256'] = {f: sha((ROOT / f).read_bytes()) for f in ['tools/brand/build.mjs', 'tools/brand/verify.py', 'tools/brand/readme-proof.mjs']}
checks['result'] = 'PASS'
(BRAND / 'evidence/validation.json').write_text(json.dumps(checks, indent=2) + '\n', encoding='utf-8')
print(f"PASS: {len(checks['files'])} asset hashes/XML/PNG checks; {len(checks['links'])} local links; 6 contrast pairs; preserved diagrams and media.")
