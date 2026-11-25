"""One-time public source acquisition; normal generation is completely offline."""
import hashlib
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN = 'b228c5d77794a84150fca41b22940bb316b1398d'
FONT_PIN = '83c62e30d87daa70216dab6b984d00d20d96d585'
records = []


def fetch(url, target):
    data = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})).read()
    upstream_sha = hashlib.sha256(data).hexdigest()
    if target.startswith('credits/'):
        data = re.sub(rb'[ \t]+(?=\r?$)', b'', data, flags=re.MULTILINE)
    path = ROOT / target
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    records.append({'path': target, 'url': url, 'sha256': hashlib.sha256(data).hexdigest(), 'upstreamSha256': upstream_sha, 'bytes': len(data)})
    return data


fetch(f'https://raw.githubusercontent.com/cathrynlavery/diagram-design/{PIN}/LICENSE', 'credits/diagram-design-LICENSE.txt')
css = fetch('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;600&family=Geist+Mono:wght@400&display=swap', 'source/google-fonts.css').decode()
for block in re.findall(r'@font-face\s*\{([^}]+)\}', css):
    family = re.search(r"font-family:\s*'([^']+)'", block)[1]
    style = re.search(r'font-style:\s*(\w+)', block)[1]
    weight = re.search(r'font-weight:\s*(\d+)', block)[1]
    url = re.search(r'url\(([^)]+)\)', block)[1]
    slug = family.lower().replace(' ', '-')
    fetch(url, f'fonts/{slug}-{weight}-{style}.ttf')
for name in ['geist', 'geistmono', 'instrumentserif']:
    fetch(f'https://raw.githubusercontent.com/google/fonts/{FONT_PIN}/ofl/{name}/OFL.txt', f'credits/{name}-OFL.txt')
(ROOT / 'source/acquisition.json').write_text(json.dumps({'diagramDesignRevision': PIN, 'googleFontsLicenseRevision': FONT_PIN, 'files': records}, indent=2) + '\n')
