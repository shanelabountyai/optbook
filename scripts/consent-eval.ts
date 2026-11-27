// npm run consent:eval — every golden case, one line each, totals per file. Exits 1 on any difference.
import { isDeepStrictEqual } from 'node:util';
import { REASON_ORDER, decide } from '../src/lib/consent/decide';
import { CONFIG, RUNNERS } from '../tests/consent/helpers/golden';
import { genInputs } from '../tests/consent/oracle/generator';
import { naiveDecide } from '../tests/consent/oracle/naive-decide';

let failed = 0;
let total = 0;
const totals: string[] = [];
for (const [name, run] of RUNNERS) {
  const outcomes = run();
  let ok = 0;
  for (const o of outcomes) {
    console.log(`${o.id} ${o.summary} ${o.ok ? 'OK' : 'DIFF'}`);
    if (!o.ok) {
      console.log(`  expected: ${JSON.stringify(o.expected)}`);
      console.log(`  actual:   ${JSON.stringify(o.actual)}`);
    }
    if (o.ok) ok += 1;
  }
  failed += outcomes.length - ok;
  total += outcomes.length;
  totals.push(`${name} ${ok}/${outcomes.length}`);
}
// The oracle comparison (AC-b6): the engine against the naive second implementation on the seeded inputs.
const inputs = genInputs();
const outcomes: Record<string, number> = {};
const reasons: Record<string, number> = Object.fromEntries(REASON_ORDER.map((c) => [c, 0]));
let agree = 0;
for (const input of inputs) {
  const a = decide(input, CONFIG);
  if (isDeepStrictEqual(a, naiveDecide(input as never, CONFIG as never))) agree += 1;
  outcomes[a.outcome] = (outcomes[a.outcome] ?? 0) + 1;
  for (const r of a.reasons) reasons[r.code]! += 1;
}
console.log(`oracle: ${agree}/${inputs.length} agree; outcomes ${JSON.stringify(outcomes)}`);
console.log(`oracle reasons: ${JSON.stringify(reasons)}`);
console.log(`consent:eval: ${totals.join(', ')}; ${total - failed}/${total} OK`);
if (failed || agree !== inputs.length) process.exitCode = 1;
