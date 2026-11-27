// npm run fixtures:check — fixtures/golden/decisions.json is the fenced JSON block of
// docs/optbook/GOLDEN-DECISIONS.md byte for byte, its SHA-256 is the one stated there, and nothing under fixtures/ is
// modified or untracked.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** The same extraction as the documented `awk '/^```json$/{f=1;next} /^```$/{f=0} f'`. */
export function extractBlock(doc: string): string {
  const out: string[] = [];
  let on = false;
  const lines = doc.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  for (const line of lines) {
    if (line === '```json') {
      on = true;
      continue;
    }
    if (line === '```') {
      on = false;
      continue;
    }
    if (on) out.push(`${line}\n`);
  }
  return out.join('');
}

const root = process.cwd();
const doc = readFileSync(join(root, 'docs', 'optbook', 'GOLDEN-DECISIONS.md'), 'utf8');
const stated = /The SHA-256 must be `([0-9a-f]{64})`/.exec(doc)?.[1];
const block = extractBlock(doc);
const file = readFileSync(join(root, 'fixtures', 'golden', 'decisions.json'), 'utf8');
const sha = createHash('sha256').update(file, 'utf8').digest('hex');
const problems: string[] = [];
if (!stated) problems.push('no stated SHA-256 found in GOLDEN-DECISIONS.md');
if (block !== file) problems.push('fixtures/golden/decisions.json differs from the block in GOLDEN-DECISIONS.md');
if (stated && sha !== stated) problems.push(`decisions.json SHA-256 ${sha} != stated ${stated}`);
let status = '';
try {
  status = execFileSync('git', ['status', '--porcelain', '--', 'fixtures'], { cwd: root, encoding: 'utf8' }).trim();
} catch (e) {
  problems.push(`git status failed: ${(e as Error).message}`);
}
if (status) problems.push(`fixtures/ has uncommitted changes:\n${status}`);
for (const p of problems) console.log(p);
console.log(`fixtures:check: decisions.json sha256 ${sha}; ${problems.length ? `${problems.length} problem(s)` : 'clean'}`);
if (problems.length) process.exitCode = 1;
