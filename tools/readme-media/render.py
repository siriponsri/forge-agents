"""Encode actual Chromium video intervals; no synthetic frames/interpolation."""
import hashlib
import json
import pathlib
import subprocess

ROOT = pathlib.Path(__file__).resolve().parents[2]
MEDIA = ROOT / 'docs' / 'media'
manifest_path = MEDIA / 'manifest.json'
manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
manifest['nativeGuardedAutomation'] = 'NOT_EXERCISED_IN_MEDIA_CAPTURE; see docs/guarded-route.md for separate bounded native developer checks'
manifest['encoder'] = subprocess.check_output(['ffmpeg', '-version'], text=True).splitlines()[0]
for clip in manifest['walkthroughs']:
    # Chromium's first video frame can lag page creation slightly. Exclude the
    # final 0.6s guard interval so adjacent navigation never bleeds into a clip.
    clip['encodedEndSeconds'] = clip['endSeconds'] - 0.6
    clip['tailExcludedSeconds'] = 0.6
    duration = clip['encodedEndSeconds'] - clip['startSeconds']
    filters = ('setpts=0.5*(PTS-STARTPTS),fps=5,scale=1008:-2:flags=lanczos,'
               'split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];'
               '[b][p]paletteuse=dither=bayer:bayer_scale=4')
    subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                    '-ss', str(clip['startSeconds']), '-t', str(duration),
                    '-i', str(MEDIA / clip['source']), '-filter_complex', filters,
                    '-loop', '0', str(MEDIA / clip['filename'])], check=True)
    clip['sourceDurationSeconds'] = round(duration, 3)

# Gallery is generated from provenance so alt text, limitations and numbered
# instructions stay adjacent to every asset when the lead refreshes the media.
lines = ['# Prepared FORGE documentation media', '',
         f"Prepared from `{manifest['preparedRevision']}`; **not final release verification**.", '',
         'Disposable engineering data. No Owner project, provider turn, live account, or product pilot. '
         '**HOME_UAT_NOT_RUN**. The production App, SQLite, HTTP session/CSRF, local Node tests, '
         'registered-file preview, verified Delivery Pack, native Office saves and native reports are real.', '',
         'Where labelled, provider/agent/run/tool observations are deliberately injected. Mission source '
         'files are deterministic engineering inputs, not model-authored output. Unknown tool results '
         'and usage remain unknown. Captions are documentation annotations, not simulated App state.', '',
         'Refresh and acceptance instructions: [capture tooling](../../tools/readme-media/README.md). '
         'Exact provenance: [manifest.json](manifest.json). Decode/hash checks: [verification.json](verification.json).', '',
         '## Walkthroughs', '',
         'All clips are real Chromium screen recordings, selected contiguous intervals at **2x speed**, '
         '5 fps and 1008px width. Intervals between walkthroughs and a 0.6s trailing guard interval are omitted; no interpolation or '
         'synthetic frames. Full source: [walkthroughs.webm](sources/walkthroughs.webm). '
         'Static alternatives and the same numbered instructions follow each GIF.', '']
static = {
          'start-forge': 'overview', 'software-mission': 'mission-preview',
          'chat-workspace': 'workspace', 'office-report': 'report-preview' if manifest['receipts']['report']['status'] == 'ready' else 'sheets'}
for clip in manifest['walkthroughs']:
    lines += [f"### {clip['name'].replace('-', ' ').title()}", '',
              f"**Qualification:** {clip['qualification']}", '',
              f"![{clip['alt']}]({clip['filename']})", '',
              f"[Static alternative](screenshots/{static[clip['name']]}.png)", '']
    lines += [f'{n}. {text}' for n, text in enumerate(clip['steps'], 1)] + ['']
lines += ['## Screenshots and lossless sources', '']
for shot in manifest['screenshots']:
    lines += [f"### {pathlib.PurePosixPath(shot['filename']).stem.replace('-', ' ').title()}", '',
              f"**Qualification:** {shot['qualification']}", '',
              f"![{shot['alt']}]({shot['filename']})", '', shot['caption'], '',
              f"[Lossless full-page source]({shot['source']})", '']
lines += ['## Diagram sources', '',
          '[Architecture](architecture.mmd) and [software delivery](software-delivery.mmd) are original '
          'Mermaid sources for the lead’s final README. They preserve FORGE canonical authority, '
          'T3 single execution ownership, and the native guarded automation qualification boundary.', '',
          '## Qualification gaps', '']
lines += [f'- {item}' for item in manifest['limitations']] + ['']
(MEDIA / 'README.md').write_text('\n'.join(lines), encoding='utf-8')

files = []
for file in sorted(MEDIA.rglob('*')):
    if not file.is_file() or file.name in {'manifest.json', 'verification.json'}:
        continue
    if file.suffix not in {'.png', '.webm', '.gif', '.svg', '.mmd'}:
        continue
    # Match repository LF attributes so hashes also verify after cherry-pick or
    # checkout on another platform, rather than hashing Windows text translation.
    if file.suffix in {'.svg', '.mmd'}:
        file.write_bytes(file.read_text(encoding='utf-8').replace('\r\n', '\n').encode('utf-8'))
    data = file.read_bytes()
    files.append({'filename': file.relative_to(MEDIA).as_posix(), 'bytes': len(data),
                  'sha256': hashlib.sha256(data).hexdigest()})
manifest['files'] = files
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'encoded': len(manifest['walkthroughs']), 'hashed': len(files)}))
