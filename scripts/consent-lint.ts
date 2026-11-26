// npm run consent:lint — the engines under src/lib/consent/ stay pure (CLAUDE.md non-negotiables 2 and 9).
// Fails on: an import other than a relative path, `zod` or `node:crypto` (and from node:crypto only createHmac,
// createHash, timingSafeEqual); require() or dynamic import(); the whole-word identifiers Date, Math.random, process,
// fetch, setTimeout, setInterval; a floating-point literal. Comments and string contents are ignored for the token
// checks (import specifiers are read from the source as written).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

export const CRYPTO_ALLOWED = ['createHmac', 'createHash', 'timingSafeEqual'];
const FORBIDDEN = [/\bDate\b/, /\bMath\.random\b/, /\bprocess\b/, /\bfetch\b/, /\bsetTimeout\b/, /\bsetInterval\b/, /\brequire\s*\(/, /\bimport\s*\(/];
const FLOAT = /(?<![\w.])\d+\.\d+(?:e[+-]?\d+)?\b|(?<![\w.])\d+e-\d+\b/i;

/** Replaces comments and string/template contents with spaces, keeping line structure. */
export function stripCode(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
    } else if (c === '/' && n === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
    } else if (c === '"' || c === "'" || c === '`') {
      out += c;
      i += 1;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
        } else {
          out += src[i] === '\n' ? '\n' : ' ';
          i += 1;
        }
      }
      out += c;
      i += 1;
    } else if (c === '/' && /[=(,:;!&|?{}[\]^~+\-*%<>]\s*$|^\s*$|return\s*$/.test(out.slice(-20).replace(/\n/g, ' '))) {
      // a regular-expression literal: blank its body
      out += c;
      i += 1;
      let inClass = false;
      while (i < src.length && (src[i] !== '/' || inClass) && src[i] !== '\n') {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
        } else {
          if (src[i] === '[') inClass = true;
          if (src[i] === ']') inClass = false;
          out += ' ';
          i += 1;
        }
      }
      out += '/';
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

export function lintSource(file: string, src: string): string[] {
  const problems: string[] = [];
  const importRe = /^\s*(?:import|export)\s+(?:type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/gm;
  for (const m of src.matchAll(importRe)) {
    const spec = m[2]!;
    const line = src.slice(0, m.index).split('\n').length;
    if (spec.startsWith('./')) continue;
    if (spec === 'zod') continue;
    if (spec === 'node:crypto') {
      const names = m[1]!.replace(/[{}]/g, '').split(',').map((s) => s.trim().split(/\s+as\s+/)[0]!).filter(Boolean);
      const bad = names.filter((x) => !CRYPTO_ALLOWED.includes(x));
      if (bad.length) problems.push(`${file}:${line}: node:crypto import not allowed: ${bad.join(', ')}`);
      continue;
    }
    problems.push(`${file}:${line}: import not allowed: ${spec}`);
  }
  if (/^\s*import\s+['"]/m.test(src)) problems.push(`${file}: side-effect import not allowed`);
  const code = stripCode(src);
  code.split('\n').forEach((text, k) => {
    for (const re of FORBIDDEN) if (re.test(text)) problems.push(`${file}:${k + 1}: forbidden token ${re.source}`);
    if (FLOAT.test(text)) problems.push(`${file}:${k + 1}: floating-point literal`);
  });
  return problems;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx|js|mjs|cjs)$/.test(n) ? [p] : [];
  });
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const root = join(process.cwd(), 'src', 'lib', 'consent');
  const files = walk(root);
  const problems = files.flatMap((f) => lintSource(relative(process.cwd(), f), readFileSync(f, 'utf8')));
  for (const p of problems) console.log(p);
  console.log(`consent:lint: ${files.length} files, ${problems.length} problem(s)`);
  if (problems.length || files.length === 0) process.exitCode = 1;
}
