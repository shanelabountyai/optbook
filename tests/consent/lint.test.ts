import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintSource } from '../../scripts/consent-lint';
import { ROOT } from './helpers/golden';

describe('consent:lint (AC-b2)', () => {
  it('src/lib/consent/ is clean', () => {
    const dir = join(ROOT, 'src/lib/consent');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBe(12);
    for (const f of files) expect(lintSource(f, readFileSync(join(dir, f), 'utf8'))).toEqual([]);
  });
  it.each([
    ["import { readFileSync } from 'node:fs';", 'import not allowed'],
    ["import { x } from '@/core/db';", 'import not allowed'],
    ["import { x } from '../app/y';", 'import not allowed'],
    ["import { randomBytes } from 'node:crypto';", 'node:crypto import not allowed'],
    ['const t = Date.now();', 'forbidden token'],
    ['const r = Math.random();', 'forbidden token'],
    ['const e = process.env.KEY;', 'forbidden token'],
    ['await fetch(url);', 'forbidden token'],
    ['setTimeout(f, 1);', 'forbidden token'],
    ["const m = require('fs');", 'forbidden token'],
    ["const m = await import('fs');", 'forbidden token'],
    ['const x = 1.5;', 'floating-point'],
  ])('catches %s', (src, msg) => {
    expect(lintSource('x.ts', src).join('\n')).toContain(msg);
  });
  it('ignores comments and strings, and names like next_allowed_at or dueDate', () => {
    expect(lintSource('x.ts', "// Date.now() 1.5\nconst s = 'process 2.5 Date';\nconst next_allowed_at = 1; const dueDate = 2; const v = 'v1.';\nconst re = /\\d+\\.\\d+/;")).toEqual([]);
  });
});
