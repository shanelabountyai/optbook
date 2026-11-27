import { describe, expect, it } from 'vitest';
import { factValue, pairStatus, replay } from '../../src/lib/consent/ledger';
import { diffPreferences, preferenceView, type Submission } from '../../src/lib/consent/preferences';
import { selectRuleSet } from '../../src/lib/consent/ruleset';
import { validateEvent, type ConsentEvent, type TokenPayload } from '../../src/lib/consent/schema';
import { CONFIG, decisionCase, runPreferences } from './helpers/golden';
import { SEED, genInputs, prng } from './oracle/generator';

const token = (ch: string): TokenPayload => ({ v: 1, kid: 'k1', org: 'org_demo', cid: 'c_0001', scope: 'preferences', ch, pur: null, mid: 'm_9', iat: 1795186800, exp: 1797778800 });
const AT = '2027-06-01T00:00:00Z'; // later than every generated event (AC-c3's stated limit)
const strict = () => {
  const s = selectRuleSet(CONFIG, 'R-NORTH', AT);
  if (!s.ok) throw new Error();
  return s.ruleSet;
};

describe('preferences: golden PC-01 to PC-07, OC-01 to OC-04 (AC-c1)', () => {
  it.each(runPreferences().map((o) => [o.id, o] as const))('%s', (_id, o) => expect(o.ok, JSON.stringify(o.actual)).toBe(true));
});

describe('preferences: rules', () => {
  const events = decisionCase('WE-33').input.events as ConsentEvent[]; // sms/promotional pending (opt-in from an email link)
  it('a pending pair toggled on from a link delivered on its own channel emits the self-confirming opt-in', () => {
    const s = replay(events);
    expect(pairStatus(s, strict(), 'sms', 'promotional')).toBe('pending');
    const sub: Submission = { purposes: { sms: { promotional: true } } };
    const fromEmail = diffPreferences({ state: s, ruleSet: strict(), catalog: CONFIG.catalog, identifierChannels: ['email', 'sms'], submission: sub, token: token('email'), at: AT });
    expect(fromEmail).toEqual({ ok: true, drafts: [] });
    const fromSms = diffPreferences({ state: s, ruleSet: strict(), catalog: CONFIG.catalog, identifierChannels: ['email', 'sms'], submission: sub, token: token('sms'), at: AT });
    if (!fromSms.ok) throw new Error();
    expect(fromSms.drafts).toMatchObject([{ type: 'OPT_IN', channel: 'sms', purpose: 'promotional', verified_channel: 'sms', method: 'preference_center' }]);
    const after = replay([...events, { ...fromSms.drafts[0]!, event_id: 'x' }]);
    expect(pairStatus(after, strict(), 'sms', 'promotional')).toBe('on');
  });
  it('a channel with no identifier on file is not offered, and toggling it is refused whole (NO_IDENTIFIER)', () => {
    const s = replay(events);
    expect(preferenceView(s, strict(), CONFIG.catalog, ['email']).channels.sms!.offered).toBe(false);
    const r = diffPreferences({ state: s, ruleSet: strict(), catalog: CONFIG.catalog, identifierChannels: ['email'], submission: { purposes: { email: { promotional: true }, sms: { newsletter: true } } }, token: token('email'), at: AT });
    expect(r).toEqual({ ok: false, error: 'NO_IDENTIFIER' });
  });
  it('every draft validates once ids are added; no submission yields a permissive draft with a global unsubscribe', () => {
    const r = prng(SEED + 20);
    for (const input of genInputs(500, SEED + 20)) {
      const s = replay(input.events);
      const sub = randomSubmission(r);
      const d = diffPreferences({ state: s, ruleSet: strict(), catalog: CONFIG.catalog, identifierChannels: ['email', 'sms'], submission: sub, token: token(r.pick(['email', 'sms'])), at: AT });
      if (!d.ok) throw new Error(d.error);
      for (const [i, x] of d.drafts.entries()) expect(validateEvent({ ...x, event_id: `d${i}` }, CONFIG.catalog).ok).toBe(true);
      if (d.drafts.some((x) => x.type === 'GLOBAL_UNSUBSCRIBE')) expect(d.drafts.some((x) => x.type === 'OPT_IN')).toBe(false);
    }
  });
  it('AC-c3: applying the drafts and rendering again shows the submitted state, except pairs pending confirmation', () => {
    const r = prng(SEED + 21);
    let pending = 0;
    for (const input of genInputs(1000, SEED + 21)) {
      const s = replay(input.events);
      const sel = selectRuleSet(CONFIG, factValue(s, 'region'), AT);
      if (!sel.ok) continue;
      const sub = { ...randomSubmission(r), global_unsubscribe: false };
      const tok = token(r.pick(['email', 'sms']));
      const d = diffPreferences({ state: s, ruleSet: sel.ruleSet, catalog: CONFIG.catalog, identifierChannels: ['email', 'sms'], submission: sub, token: tok, at: AT });
      if (!d.ok) throw new Error(d.error);
      const after = replay([...input.events, ...d.drafts.map((x, i) => ({ ...x, event_id: `d${i}` }))]);
      const view = preferenceView(after, sel.ruleSet, CONFIG.catalog, ['email', 'sms']);
      for (const [c, pairs] of Object.entries(sub.purposes ?? {})) {
        for (const [p, want] of Object.entries(pairs)) {
          const got = view.channels[c]!.purposes[p];
          if (got === 'pending') {
            expect(want).toBe(true);
            pending += 1;
          } else expect(got, `${c}/${p}`).toBe(want ? 'on' : 'off');
        }
      }
      for (const [c, choice] of Object.entries(sub.frequency ?? {})) expect(view.channels[c]!.frequency).toBe(choice);
    }
    expect(pending).toBeGreaterThan(0);
  });
});

function randomSubmission(r: ReturnType<typeof prng>): Submission {
  const purposes: Record<string, Record<string, boolean>> = {};
  for (const c of ['email', 'sms']) for (const p of ['newsletter', 'product_updates', 'promotional']) if (r.chance(60)) (purposes[c] ??= {})[p] = r.chance(50);
  const frequency: Record<string, string> = {};
  for (const c of ['email', 'sms']) if (r.chance(30)) frequency[c] = r.pick(['standard', 'weekly', 'monthly']);
  return { purposes, frequency, global_unsubscribe: r.chance(15) };
}
