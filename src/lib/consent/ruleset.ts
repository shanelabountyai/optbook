// Rule-set validation and selection (PRD §4.5, §5b.4, AC-b7). Rules are data (CLAUDE.md non-negotiable 11).
import { ConfigSchema, FanoutPolicySchema, NEVER_EXEMPT, EXEMPTIBLE, type Config, type FanoutPolicy, type RuleSet } from './schema';
import { parseHm, toEpoch } from './time';

export type ConfigError = { error: string; field: string };

function zodField(path: readonly PropertyKey[]): string {
  return path.map((p) => (typeof p === 'number' ? `[${p}]` : `.${String(p)}`)).join('').replace(/^\./, '');
}

/** Validates the catalog, region map and rule sets together. Refusals name the field (AC-b7). */
export function validateConfig(input: unknown): { ok: true; config: Config } | ({ ok: false } & ConfigError) {
  const parsed = ConfigSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    return { ok: false, error: 'BAD_FIELD', field: zodField(issue.path) };
  }
  const config = parsed.data;
  const { catalog } = config;
  const channels = new Set(catalog.channels);
  const purposes = new Set(Object.keys(catalog.purposes));
  const bad = (error: string, field: string) => ({ ok: false as const, error, field });

  const ids = new Set(config.rule_sets.map((r) => r.id));
  for (const [region, id] of Object.entries(config.region_map.map)) {
    if (!ids.has(id)) return bad('UNKNOWN_RULE_SET', `region_map.map.${region}`);
  }
  if (!ids.has(config.region_map.default)) return bad('UNKNOWN_RULE_SET', 'region_map.default');

  const seen = new Map<string, string>();
  for (const [i, rs] of config.rule_sets.entries()) {
    const at = `rule_sets[${i}]`;
    const key = `${rs.id}@${toEpoch(rs.effective_from)}`;
    if (seen.has(key)) return bad('DUPLICATE_EFFECTIVE_FROM', `${at}.effective_from`);
    seen.set(key, at);
    for (const p of Object.keys(rs.lawful_basis)) if (!purposes.has(p)) return bad('UNKNOWN_PURPOSE', `${at}.lawful_basis.${p}`);
    for (const p of purposes) if (!(p in rs.lawful_basis)) return bad('MISSING_FIELD', `${at}.lawful_basis.${p}`);
    for (const c of rs.double_opt_in.required_channels) if (!channels.has(c)) return bad('UNKNOWN_CHANNEL', `${at}.double_opt_in.required_channels`);
    for (const c of rs.quiet_hours.channels) if (!channels.has(c)) return bad('UNKNOWN_CHANNEL', `${at}.quiet_hours.channels`);
    const start = parseHm(rs.quiet_hours.start);
    const end = parseHm(rs.quiet_hours.end);
    if (start === null) return bad('BAD_FIELD', `${at}.quiet_hours.start`);
    if (end === null || end === start) return bad('BAD_FIELD', `${at}.quiet_hours.end`);
    for (const c of Object.keys(rs.frequency.max_marketing_sends)) {
      if (!channels.has(c)) return bad('UNKNOWN_CHANNEL', `${at}.frequency.max_marketing_sends.${c}`);
    }
    for (const [c, reasons] of Object.entries(rs.transactional_exempt_from)) {
      if (!channels.has(c)) return bad('UNKNOWN_CHANNEL', `${at}.transactional_exempt_from.${c}`);
      for (const r of reasons) {
        if (NEVER_EXEMPT.includes(r)) return bad('NEVER_EXEMPT_REASON', `${at}.transactional_exempt_from.${c}`);
        if (!EXEMPTIBLE.includes(r)) return bad('BAD_FIELD', `${at}.transactional_exempt_from.${c}`);
      }
    }
  }
  return { ok: true, config };
}

export function validateFanoutPolicy(input: unknown): { ok: true; policy: FanoutPolicy } | ({ ok: false } & ConfigError) {
  const parsed = FanoutPolicySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'BAD_FIELD', field: zodField(parsed.error.issues[0]!.path) };
  if (parsed.data.max_attempts !== parsed.data.backoff_seconds.length + 1) return { ok: false, error: 'BAD_FIELD', field: 'max_attempts' };
  return { ok: true, policy: parsed.data };
}

export type Selection = { ok: true; ruleSet: RuleSet } | { ok: false; error: 'NO_RULE_SET_IN_FORCE'; id: string };

/** PRD §5b.4: region → rule-set id (default when absent or unknown) → the version in force at `at`. */
export function selectRuleSet(config: Config, region: string | null, at: string): Selection {
  const id = region !== null && Object.hasOwn(config.region_map.map, region) ? config.region_map.map[region]! : config.region_map.default;
  const t = toEpoch(at);
  let best: RuleSet | null = null;
  for (const rs of config.rule_sets) {
    if (rs.id !== id || toEpoch(rs.effective_from) > t) continue;
    if (!best || toEpoch(rs.effective_from) > toEpoch(best.effective_from)) best = rs;
  }
  return best ? { ok: true, ruleSet: best } : { ok: false, error: 'NO_RULE_SET_IN_FORCE', id };
}
