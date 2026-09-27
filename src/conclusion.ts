import { formatMoney } from './domain';
import type { FinanceScenario, ScenarioProjection } from './types';

export type ConclusionKind = 'none' | 'single' | 'identical' | 'insignificant' | 'comparison';

export interface ScenarioConclusion {
  kind: ConclusionKind;
  sentences: string[];
}

/** 终值差距小于该比例时，视为差异不显著 */
const INSIGNIFICANT_THRESHOLD = 0.02;

type DimKey = 'annualRate' | 'feeRate' | 'years' | 'recurring' | 'principal';
type GroupKey = 'return' | 'years' | 'recurring' | 'principal';

const COMPARED_FIELDS = ['principal', 'recurring', 'years', 'annualRate', 'inflationRate', 'feeRate'] as const;

interface Entry {
  scenario: FinanceScenario;
  projection: ScenarioProjection;
}

/** 入口：根据当前这组情景及其投影，生成一段可读结论。纯函数，参数一变结果就重算。 */
export function buildConclusion(scenarios: FinanceScenario[], projections: ScenarioProjection[]): ScenarioConclusion {
  const projectionById = new Map(projections.map((projection) => [projection.scenarioId, projection]));
  const entries: Entry[] = scenarios
    .map((scenario) => {
      const projection = projectionById.get(scenario.id);
      return projection ? { scenario, projection } : null;
    })
    .filter((entry): entry is Entry => entry !== null);

  if (entries.length === 0) {
    return { kind: 'none', sentences: [] };
  }

  if (entries.length === 1) {
    return { kind: 'single', sentences: [singleSentence(entries[0])] };
  }

  const first = entries[0].scenario;
  const allParamsEqual = COMPARED_FIELDS.every((field) => entries.every((entry) => entry.scenario[field] === first[field]));
  if (allParamsEqual) {
    return { kind: 'identical', sentences: [identicalSentence(entries)] };
  }

  const sorted = [...entries].sort((a, b) => b.projection.finalValue - a.projection.finalValue);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const gap = top.projection.finalValue - bottom.projection.finalValue;
  const denom = Math.max(Math.abs(top.projection.finalValue), Math.abs(bottom.projection.finalValue), 1);
  const relative = gap / denom;

  if (gap <= 0 || relative < INSIGNIFICANT_THRESHOLD) {
    return { kind: 'insignificant', sentences: insignificantSentences(top, bottom, gap, relative) };
  }

  return {
    kind: 'comparison',
    sentences: comparisonSentences(entries, sorted, top, bottom, gap, relative),
  };
}

function singleSentence(entry: Entry): string {
  const { scenario, projection } = entry;
  return `当前只有 1 个有效情景「${scenario.name}」：${scenario.years} 年后名义终值约 ${cny(projection.finalValue)}，`
    + `累计投入 ${cny(projection.totalInvested)}，扣除通胀后约 ${cny(projection.finalRealValue)}。`
    + '新增或复制一个情景，即可对比方案差异。';
}

function identicalSentence(entries: Entry[]): string {
  const { scenario, projection } = entries[0];
  return `当前 ${entries.length} 个情景的参数完全相同，名义终值都约为 ${cny(projection.finalValue)}`
    + `（累计投入 ${cny(projection.totalInvested)}），「${scenario.name}」与其他方案没有可比差异。`
    + '调整收益率、期限、投入或费用中的任意一项，即可看到差距来源。';
}

function insignificantSentences(top: Entry, bottom: Entry, gap: number, relative: number): string[] {
  if (gap <= 0) {
    return [
      `「${top.scenario.name}」和「${bottom.scenario.name}」的名义终值相同，均约为 ${cny(top.projection.finalValue)}，`
      + '在当前假设下没有实质差异，参数上的不同没有拉开结果。',
    ];
  }
  return [
    `终值最高的「${top.scenario.name}」（约 ${cny(top.projection.finalValue)}）与最低的「${bottom.scenario.name}」`
    + `（约 ${cny(bottom.projection.finalValue)}）仅相差约 ${cny(gap)}（约 ${formatPercent(relative)}），差异不显著：`
    + '各方案参数虽有不同，但在当前假设下终值基本重合，不必仅凭这一点区分高下。',
  ];
}

function comparisonSentences(
  entries: Entry[],
  sorted: Entry[],
  top: Entry,
  bottom: Entry,
  gap: number,
  relative: number,
): string[] {
  const sentences: string[] = [];

  const topGroup = sorted.filter((entry) => (top.projection.finalValue - entry.projection.finalValue) / Math.max(top.projection.finalValue, 1) <= 0.005);
  if (topGroup.length > 1) {
    const names = topGroup.map((entry) => `「${entry.scenario.name}」`).join('、');
    sentences.push(
      `${names}名义终值并列最高，均约为 ${cny(top.projection.finalValue)}；最低的是「${bottom.scenario.name}」，`
      + `约 ${cny(bottom.projection.finalValue)}，差距约 ${cny(gap)}（约 ${formatPercent(relative)}）。`,
    );
  } else {
    sentences.push(
      `终值最高的是「${top.scenario.name}」，名义终值约 ${cny(top.projection.finalValue)}；`
      + `最低的是「${bottom.scenario.name}」，约 ${cny(bottom.projection.finalValue)}，`
      + `两者相差约 ${cny(gap)}（约 ${formatPercent(relative)}）。`,
    );
  }

  const impacts = attributeGap(top.scenario, bottom.scenario);
  const driverSentence = buildDriverSentence(top.scenario, bottom.scenario, impacts, gap);
  if (driverSentence) sentences.push(driverSentence);

  const offset = buildOffsetSentence(top.scenario, bottom.scenario, impacts, gap);
  if (offset) sentences.push(offset);

  const realSentence = buildRealSentence(entries, top);
  if (realSentence) sentences.push(realSentence);

  return sentences;
}

/**
 * 用 Shapley 值把终值差距分摊到四组参数（净收益、期限、月投入、初始本金），
 * 再把净收益组按边际贡献拆成收益率与费用，保证各组贡献之和恰好等于终值差距。
 */
function attributeGap(winner: FinanceScenario, loser: FinanceScenario): Map<DimKey, number> {
  const groups: GroupKey[] = ['return', 'years', 'recurring', 'principal'];
  const memo = new Map<string, number>();
  const nominalFinal = (scenario: FinanceScenario): number => {
    const key = `${scenario.annualRate}|${scenario.feeRate}|${scenario.years}|${scenario.recurring}|${scenario.principal}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    const value = calculateProjectionLite(scenario);
    memo.set(key, value);
    return value;
  };
  const applyGroup = (base: FinanceScenario, group: GroupKey): FinanceScenario => {
    if (group === 'return') return { ...base, annualRate: winner.annualRate, feeRate: winner.feeRate };
    return { ...base, [group]: winner[group] };
  };

  const groupContrib = new Map<GroupKey, number>(groups.map((group) => [group, 0]));
  let permutationCount = 0;
  for (const order of permutations(groups)) {
    permutationCount += 1;
    let current: FinanceScenario = { ...loser };
    let previous = nominalFinal(current);
    for (const group of order) {
      current = applyGroup(current, group);
      const next = nominalFinal(current);
      groupContrib.set(group, (groupContrib.get(group) ?? 0) + (next - previous));
      previous = next;
    }
  }
  groups.forEach((group) => groupContrib.set(group, (groupContrib.get(group) ?? 0) / permutationCount));

  // 净收益组拆分为收益率与费用：按各自单独切换为赢家参数时的带符号边际效应比例分摊，
  // 因而赢家费用更高时，费用项得到负贡献，会作为抵消因素出现在结论里。
  const returnContrib = groupContrib.get('return') ?? 0;
  const rateMarginal = nominalFinal({ ...loser, annualRate: winner.annualRate }) - nominalFinal(loser);
  const feeMarginal = nominalFinal({ ...loser, feeRate: winner.feeRate }) - nominalFinal(loser);
  const marginalTotal = rateMarginal + feeMarginal;
  const impacts = new Map<DimKey, number>([
    ['years', groupContrib.get('years') ?? 0],
    ['recurring', groupContrib.get('recurring') ?? 0],
    ['principal', groupContrib.get('principal') ?? 0],
  ]);
  if (Math.abs(marginalTotal) > 0) {
    impacts.set('annualRate', returnContrib * rateMarginal / marginalTotal);
    impacts.set('feeRate', returnContrib * feeMarginal / marginalTotal);
  } else {
    impacts.set('annualRate', returnContrib);
    impacts.set('feeRate', 0);
  }
  return impacts;
}

function buildDriverSentence(winner: FinanceScenario, loser: FinanceScenario, impacts: Map<DimKey, number>, gap: number): string {
  const candidates = (Array.from(impacts.entries()) as Array<[DimKey, number]>)
    .filter(([key, value]) => value > 0 && value >= gap * 0.05 && hasAdvantage(winner, loser, key))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2);
  if (candidates.length === 0) return '';
  const phrases = candidates.map(([key]) => advantagePhrase(winner, loser, key));
  if (phrases.length === 1) return `拉开差距的主要因素是${phrases[0]}。`;
  return `差距主要来自${phrases[0]}，其次是${phrases[1]}。`;
}

function buildOffsetSentence(winner: FinanceScenario, loser: FinanceScenario, impacts: Map<DimKey, number>, gap: number): string {
  const worst = (Array.from(impacts.entries()) as Array<[DimKey, number]>)
    .filter(([, value]) => value <= -gap * 0.05)
    .sort((a, b) => a[1] - b[1])[0];
  if (!worst) return '';
  return `不过「${winner.name}」在${disadvantagePhrase(winner, loser, worst[0])}上处于劣势，部分抵消了它的终值优势。`;
}

function buildRealSentence(entries: Entry[], nominalTop: Entry): string {
  const realTop = [...entries].sort((a, b) => b.projection.finalRealValue - a.projection.finalRealValue)[0];
  if (realTop.scenario.id === nominalTop.scenario.id) return '';
  const inflationDiffers = entries.some((entry) => entry.scenario.inflationRate !== nominalTop.scenario.inflationRate);
  if (!inflationDiffers) return '';
  const realGap = realTop.projection.finalRealValue - nominalTop.projection.finalRealValue;
  if (realGap / Math.max(realTop.projection.finalRealValue, 1) < 0.02) return '';
  return `但扣除通胀后，「${realTop.scenario.name}」的实际终值约 ${cny(realTop.projection.finalRealValue)}，`
    + `反而高于「${nominalTop.scenario.name}」的 ${cny(nominalTop.projection.finalRealValue)}——名义上的领先被更高的通胀假设侵蚀了一部分。`;
}

function hasAdvantage(winner: FinanceScenario, loser: FinanceScenario, key: DimKey): boolean {
  if (key === 'feeRate') return winner.feeRate < loser.feeRate;
  return winner[key] > loser[key];
}

function advantagePhrase(winner: FinanceScenario, loser: FinanceScenario, key: DimKey): string {
  switch (key) {
    case 'annualRate':
      return `年化收益更高（${rate(loser.annualRate)} → ${rate(winner.annualRate)}）`;
    case 'feeRate':
      return `费用更低（${rate(loser.feeRate)} → ${rate(winner.feeRate)}）`;
    case 'years':
      return `投资期限更长（${loser.years} 年 → ${winner.years} 年）`;
    case 'recurring':
      return `每月投入更多（${cny(loser.recurring)} → ${cny(winner.recurring)}）`;
    case 'principal':
      return `初始投入更高（${cny(loser.principal)} → ${cny(winner.principal)}）`;
  }
}

function disadvantagePhrase(winner: FinanceScenario, loser: FinanceScenario, key: DimKey): string {
  switch (key) {
    case 'annualRate':
      return `年化收益（${rate(winner.annualRate)} 对 ${rate(loser.annualRate)}）`;
    case 'feeRate':
      return `费用率（${rate(winner.feeRate)} 对 ${rate(loser.feeRate)}）`;
    case 'years':
      return `投资期限（${winner.years} 年对 ${loser.years} 年）`;
    case 'recurring':
      return `每月投入（${cny(winner.recurring)} 对 ${cny(loser.recurring)}）`;
    case 'principal':
      return `初始投入（${cny(winner.principal)} 对 ${cny(loser.principal)}）`;
  }
}

function rate(value: number): string {
  return `${value}%`;
}

function formatPercent(ratio: number): string {
  if (ratio < 0.1) return `${(ratio * 100).toFixed(1)}%`;
  return `${Math.round(ratio * 100)}%`;
}

/** 结论文案中的金额：过万用「万元」，避免一长串数字依旧难读。 */
function cny(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${Math.round(value / 10_000).toLocaleString('zh-CN')} 万元`;
  if (abs >= 10_000) {
    const wan = (value / 10_000).toFixed(1).replace(/\.0$/, '');
    return `${wan} 万元`;
  }
  return `${formatMoney(value)} 元`;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    permutations(rest).forEach((restPerm) => result.push([item, ...restPerm]));
  });
  return result;
}

/** 与 domain.calculateProjection 相同的名义终值算法，避免构造整年点位，结论计算更快。 */
function calculateProjectionLite(scenario: FinanceScenario): number {
  const monthlyRate = Math.pow(1 + (scenario.annualRate - scenario.feeRate) / 100, 1 / 12) - 1;
  let nominal = scenario.principal;
  for (let month = 1; month <= scenario.years * 12; month += 1) {
    nominal = nominal * (1 + monthlyRate) + scenario.recurring;
  }
  return nominal;
}
