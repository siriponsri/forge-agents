"""Audit exported assets and run the installed skill gate without changing it.

The owner requests embedded fonts. The installed gate rejects ALL CSS url()s,
including safe data:font/ttf. Record that raw result, validate the exact font
bytes against acquisition.json, then gate a temporary font-face-free copy.
"""
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
skill = Path(sys.argv[1]).resolve()
gate = skill / 'scripts/self_check.py'
acquired = json.loads((root / 'source/acquisition.json').read_text())
expected = {f['sha256'] for f in acquired['files'] if f['path'].endswith('.ttf')}
for row in acquired['files']:
    assert hashlib.sha256((root / row['path']).read_bytes()).hexdigest() == row['sha256'], row['path']

report = {'scope': 'Documentation diagrams only; not product or live qualification', 'fontPolicy': 'Exact acquired TTF bytes only; no external fetch at render time', 'variants': []}
for html in sorted(root.glob('*.html')):
    source = html.read_text(encoding='utf-8')
    raw = subprocess.run([sys.executable, str(gate), str(html)], capture_output=True, text=True)
    errors = [line.strip()[2:] for line in raw.stdout.splitlines() if line.strip().startswith('- ')]
    assert raw.returncode == 1 and errors == ['non-fragment CSS url() is not allowed'] * 5, raw.stdout
    faces = re.findall(r'@font-face\{[^}]+\}', source)
    digests = []
    for face in faces:
        data = re.search(r'url\(data:font/ttf;base64,([A-Za-z0-9+/=]+)\)', face)
        assert data, 'Only embedded TTF is allowed'
        font = base64.b64decode(data[1], validate=True)
        digest = hashlib.sha256(font).hexdigest()
        assert digest in expected and font[:4] == b'\x00\x01\x00\x00'
        digests.append(digest)
    assert set(digests) == expected
    sanitized = re.sub(r'@font-face\{[^}]+\}', '', source)
    with tempfile.TemporaryDirectory(prefix='forge-diagram-gate-') as d:
        temp = Path(d) / html.name
        temp.write_text(sanitized, encoding='utf-8')
        remaining = subprocess.run([sys.executable, str(gate), str(temp)], capture_output=True, text=True)
        assert remaining.returncode == 0, remaining.stdout + remaining.stderr
    svg = ET.fromstring((root / html.with_suffix('.svg').name).read_text(encoding='utf-8'))
    ns = {'s': 'http://www.w3.org/2000/svg'}
    assert not svg.findall('.//s:text', ns), 'Static lettering must be outlined'
    assert not svg.findall('.//s:style', ns), 'Static asset must be independent of CSS'
    assert not svg.findall('.//s:script', ns)
    assert not svg.findall('.//s:image', ns)
    ids = [e.attrib['id'] for e in svg.iter() if 'id' in e.attrib]
    assert len(ids) == len(set(ids))
    assert list(svg)[0].tag.endswith('title') and list(svg)[1].tag.endswith('desc')
    report['variants'].append({'file': html.name, 'rawSkillGate': {'exit': raw.returncode, 'errors': errors}, 'embeddedFontAudit': 'PASS', 'skillGateAfterRemovingOnlyAuditedFontFaces': 'PASS', 'outlinedSVGStructure': 'PASS'})

# Verify generated inventory, including every HTML, SVG and PNG export.
inventory = json.loads((root / 'evidence/render-checks.json').read_text())
for f in inventory['files']:
    assert hashlib.sha256((root / f['file']).read_bytes()).hexdigest() == f['sha256'], f['file']
report['generatedFileHashes'] = 'PASS'
current = (root.parents[1] / 'README.md').read_text(encoding='utf-8')
original = subprocess.run(['git', 'show', 'b238a5d:README.md'], capture_output=True, check=True).stdout.decode('utf-8')
old = re.sub(r'```mermaid\n[\s\S]*?```', '[DIAGRAM]', original)
new = re.sub(r'<picture>[\s\S]*?</picture>\n\n\*(?:Read left|The main)[\s\S]*?\.\*', '[DIAGRAM]', current)
assert old == new, 'README copy outside the two diagram blocks / embedding captions changed'
report['READMEOutsideDiagramEmbeds'] = 'PASS'
(root / 'evidence/skill-checks.json').write_text(json.dumps(report, indent=2) + '\n')

refs = ['SKILL.md', 'references/profiles.md', 'references/style-guide.md', 'references/semantic-patterns.md', 'references/type-process.md', 'references/type-architecture.md', 'references/layout-budget.md', 'references/output-spec.md', 'references/import-mermaid.md', 'references/export.md', 'assets/template.html', 'assets/template-dark.html', 'assets/template-full.html', 'scripts/self_check.py']
provenance = {'package': 'diagram-design', 'installedVersion': '2.6.48', 'source': 'https://github.com/cathrynlavery/diagram-design', 'usage': 'Editorial system and adapted template structure; original FORGE layout and content', 'files': [{'path': p, 'sha256': hashlib.sha256((skill / p).read_bytes()).hexdigest()} for p in refs]}
(root / 'source/skill-provenance.json').write_text(json.dumps(provenance, indent=2) + '\n')
print('PASS: 6 exact-font audits, 6 remaining skill gates, 6 outlined SVG structures and generated file hashes.')
print('Raw installed self_check.py rejects embedded font URLs; the explicit exception is recorded, not hidden.')
