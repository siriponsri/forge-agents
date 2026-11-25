// Reuse the existing comprehensive Guarded CLI regression against the NEW image.
// Only staging paths/build-report check differ; tool/gate assertions unchanged.
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
const generation = path.resolve(process.argv[2]), meta = JSON.parse(await readFile(path.join(generation, 'generation.json'), 'utf8'));
if (meta.root !== generation || !path.basename(generation).startsWith('forge-frontend-generation-')) throw Error('NEW_GENERATION_REQUIRED');
const source = new URL('../guarded-runtime/cli-fixture.mjs', import.meta.url);
let code = await readFile(source, 'utf8');
const from = code.indexOf('const buildReport='), to = code.indexOf('\nconst root=', from);
if (from < 0 || to < 0) throw Error('GUARDED_REGRESSION_SEAM_CHANGED');
code = code.slice(0, from) + 'if(JSON.parse(await readFile(path.join(cache,"opencode-frontend-build.json"),"utf8")).exitCode!==0)throw Error("NEW_BUILD_REQUIRED");' + code.slice(to);
code = code.replace('opencode/forge-guarded-cli-build/', 'opencode/forge-frontend-cli-build/');
code = code.replaceAll("'cli-fixture-report.json'", "'guarded-default-regression.json'").replaceAll("'cli-fixture-last-log.txt'", "'guarded-default-last-log.txt'");
code = code.replace(/from '(\.{1,2}\/[^']+)'/g, (_match, specifier) => `from ${JSON.stringify(new URL(specifier, source).href)}`);
const file = path.join(generation, 'guarded-default-regression.mjs'); await writeFile(file, code);
const child = spawn(process.execPath, [file, generation], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let stdout = '', stderr = '';
child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
const exit = await new Promise((resolve, reject) => { child.once('close', resolve); child.once('error', reject); });
console.log(stdout); if (stderr) console.error(stderr); if (exit !== 0) process.exitCode = 1;
