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
parser.add_argument('--baseline', default='631ca22')
parser.add_argument('--integrated', action='store_true', help='Verify assets in the integrated product; do not require the whole Git delta to contain only brand files.')
parser.add_argument('--output', help='Write the verification report to this path instead of replacing the worker package report.')
args = parser.parse_args()
ROOT = Path(__file__).resolve().parents[2]
BRAND = ROOT / 'docs/brand'
evidence = json.loads((BRAND / 'evidence/exports.json').read_text(encoding='utf-8'))
checks = {'baseline': args.baseline, 'scope': 'integrated asset verification' if args.integrated else 'isolated brand-only delta', 'files': [], 'links': [], 'preserved': {}}

def sha(data):
    return hashlib.sha256(data).hexdigest()

PALETTE = {'orange': '#f97316', 'yellow': '#f2c94c', 'gray': '#8b9199'}
assert evidence['palette'] == PALETTE and evidence['defaultVariant'] == 'default'
assert evidence['sourceSHA256'] == sha((ROOT / evidence['generator']).read_bytes())
checks['palette'] = PALETTE
checks['default_is_colored'] = True
repeat = json.loads((BRAND / 'evidence/determinism.json').read_text(encoding='utf-8'))
assert repeat['result'] == 'PASS' and repeat['reruns'] == 2
assert repeat['generatorSHA256'] == evidence['sourceSHA256']
assert repeat['verifierSHA256'] == sha((ROOT / 'tools/brand/determinism.py').read_bytes())
for file, expected in repeat['files'].items():
    assert sha((BRAND / file).read_bytes()) == expected
checks['repeat_builds'] = {'result': repeat['result'], 'reruns': repeat['reruns'], 'identical_files': len(repeat['files'])}

def effective_fills(element, inherited=None):
    fill = element.attrib.get('fill', inherited)
    result = {fill} if element.tag.endswith('}path') else set()
    for child in element:
        result |= effective_fills(child, fill)
    return result

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
            assert all(not key.startswith('on') and key != 'style' for el in svg.iter() for key in el.attrib)
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
assert layout['generatorSHA256'] == sha((ROOT / 'tools/brand/readme-proof.mjs').read_bytes())
for capture in layout['files']:
    assert sha((BRAND / 'evidence' / capture['file']).read_bytes()) == capture['sha256']
for logo in layout['logos']:
    assert logo['colored'] and sha((ROOT / logo['file']).read_bytes()) == logo['sha256']
assert {(v['theme'], v['viewport']) for v in layout['variants']} == {('light', 900), ('light', 375), ('dark', 900), ('dark', 375)}
for v in layout['variants']:
    expected = 'default' if v['theme'] == 'light' else 'for-dark'
    assert v['visibleLogoCount'] == 1 and len(v['visibleLogo']) == 1
    assert f'forge-lockup-{expected}.svg' in v['visibleLogo'][0]
    assert v['documentWidth'] == v['viewport'] and not v['externalRequests'] and not v['pageErrors']
    assert all(i['decoded'] for i in v['images']) and all(h['fits'] for h in v['headings'])

def lum(color):
    rgb = [int(color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return sum((v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) * w
               for v, w in zip(rgb, [.2126, .7152, .0722]))

assert len(evidence['contrast']['neutralText']) == 4
assert len(evidence['contrast']['decorativeAccents']) == 12
for category, pairs in evidence['contrast'].items():
    for pair in pairs:
        a, b = sorted([lum(pair['foreground']), lum(pair['background'])])
        ratio = (b + .05) / (a + .05)
        assert abs(ratio - pair['ratio']) < 1e-10
        if category == 'neutralText':
            assert pair['minimum'] == 7 and ratio >= 7
        else:
            assert pair['foreground'] in PALETTE.values() and pair['minimum'] is None
checks['contrast'] = evidence['contrast']

assert len(evidence['exports']) == 15
for asset in evidence['exports']:
    file = BRAND / f"exports/forge-{asset['name']}-{asset['variant']}.png"
    with Image.open(file) as img:
        assert img.size == (asset['pngWidth'], asset['pngHeight'])
    source = BRAND / f"exports/forge-{asset['name']}-{asset['variant']}.svg"
    svg = ET.parse(source).getroot()
    assert [float(svg.attrib[k]) for k in ('width', 'height')] == [asset['svgWidth'], asset['svgHeight']]
    fills = effective_fills(svg)
    if asset['variant'] in ('default', 'for-light', 'for-dark'):
        assert asset['colored'] and set(PALETTE.values()) <= fills
        assert fills == set(PALETTE.values()) | ({asset['ink']} if asset['name'] != 'mark' else set())
    else:
        assert not asset['colored'] and fills == {asset['ink']}
        assert 'fallback' in asset['role']

checks['small_size'] = []
for size in (16, 24, 32, 48, 64):
    for variant in ('default', 'for-light', 'for-dark'):
        file = BRAND / f'exports/forge-mark-{variant}-{size}.png'
        with Image.open(file) as img:
            assert img.size == (size, size)
            pixels = list(img.get_flattened_data()) if hasattr(img, 'get_flattened_data') else list(img.getdata())
            counts = {name: sum(p == tuple(bytes.fromhex(color[1:])) + (255,) for p in pixels) for name, color in PALETTE.items()}
            assert all(n > 0 for n in counts.values()), f'Accent disappeared at {size}px: {counts}'
            assert counts['orange'] > counts['yellow'] + counts['gray'], 'Orange must dominate the mark'
            checks['small_size'].append({'file': file.relative_to(BRAND).as_posix(), 'size': size, 'opaque_palette_pixels': counts})
for name in ('mark', 'wordmark', 'lockup'):
    for suffix in ('svg', 'png'):
        assert (BRAND / f'exports/forge-{name}-default.{suffix}').read_bytes() == (BRAND / f'exports/forge-{name}-for-light.{suffix}').read_bytes()

readme_bytes = (ROOT / 'README.md').read_bytes()
baseline_bytes = subprocess.check_output(['git', 'show', f'{args.baseline}:README.md'], cwd=ROOT)
assert re.findall(rb'<picture>[\s\S]*?</picture>', baseline_bytes) == re.findall(rb'<picture>[\s\S]*?</picture>', readme_bytes)
readme = readme_bytes.decode('utf-8')
baseline = baseline_bytes.decode('utf-8')
if not args.integrated:
    assert readme.replace('forge-lockup-default.svg#gh-light-mode-only', 'forge-lockup-for-light.svg#gh-light-mode-only') == baseline, 'README changed outside logo embed reference'
    checks['preserved']['readme_text_except_logo_reference_identical'] = True
assert re.findall(r'<picture>[\s\S]*?</picture>', baseline) == re.findall(r'<picture>[\s\S]*?</picture>', readme)
checks['preserved']['diagram_picture_blocks_byte_identical'] = True
media = lambda s: re.findall(r'!\[[^\]]*\]\(docs/media/[^)]+\)', s)
assert media(readme) == media(baseline), 'Existing screenshot/GIF paths or alt labels changed'
checks['preserved']['existing_media_paths_and_alt_labels_identical'] = True
assert '2x speed' in readme and 'predetermined' in readme and 'injected' in readme
assert 'Apache-2.0' in readme and 'Legacy launchers retain their original meaning' in readme
assert 'Strategist' in readme
checkpoint = 'f2387e866a2ae3808ad1989a0a7860ae437e9956' if args.integrated else 'd928e9c'
assert checkpoint in readme, 'README must retain its applicable development checkpoint'
checks['readme_sha256'] = sha(readme.encode())
assert layout['readmeSHA256'] == checks['readme_sha256'], 'README layout captures need regeneration'
checks['readme_layout_variants'] = len(layout['variants'])
changed = subprocess.check_output(['git', 'diff', '--name-only', args.baseline], cwd=ROOT).decode().splitlines()
if not args.integrated:
    assert all(p in ('README.md', 'docs/worker-brand-color.md') or p.startswith(('docs/brand/', 'tools/brand/')) for p in changed), changed
preserved_paths = ['bootstrap/payload', 'bootstrap/P11_PORTABLE_PACKAGE_MANIFEST.json', 'runtime', 'adapters/ao']
if not args.integrated:
    preserved_paths += ['docs/media', 'docs/diagrams']
subprocess.run(['git', 'diff', '--exit-code', args.baseline, '--', *preserved_paths], cwd=ROOT, check=True, capture_output=True)
checks['preserved']['protected_legacy_files_identical'] = True
checks['whole_tree_brand_only_scope_guard'] = 'not applicable to integrated product' if args.integrated else 'PASS'

def anchor_set(source):
    anchors = set()
    for heading in re.findall(r'^#{1,6}\s+(.+)$', source, re.M):
        heading = heading.lower().strip()
        anchors.add(re.sub(r'[^\w\- ]', '', heading).replace(' ', '-'))
    return anchors

docs = [ROOT / 'README.md', BRAND / 'README.md', ROOT / 'docs/worker-brand-color.md']
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

checks['source_sha256'] = {f: sha((ROOT / f).read_bytes()) for f in ['tools/brand/build.mjs', 'tools/brand/determinism.py', 'tools/brand/verify.py', 'tools/brand/readme-proof.mjs']}
checks['result'] = 'PASS'
output = Path(args.output).resolve() if args.output else BRAND / 'evidence/validation.json'
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(checks, indent=2) + '\n', encoding='utf-8', newline='\n')
print(f"PASS ({checks['scope']}): {len(checks['files'])} asset hashes/XML/PNG checks; {len(checks['links'])} local links; 15 native small-size checks; four neutral text pairs >=7:1; 12 decorative pairs measured only; diagram embeds/media links and protected legacy preserved.")
