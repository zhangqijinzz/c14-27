import { calculateProjection, formatMoney } from './domain';
import type { FinanceScenario, ScenarioField, ScenarioProjection } from './types';

export type ConclusionKind = 'empty' | 'single' | 'identical' | 'close' | 'ranked';

export interface Conclusion {
  kind: ConclusionKind;
  title: string;
  details: string[];
}

interface RankedEntry {
  scenario: FinanceScenario;
  projection: ScenarioProjection;
}

interface DriverGroup {
  label: string;
  fields: ScenarioField[];
}

/** 最高与最低终值的相对差距低于该比例时，判定为差异不显著 */
const CLOSE_THRESHOLD = 0.01;
/** 归因中占比达到该值的因素才作为次要来源提及 */
const SECONDARY_DRIVER_THRESHOLD = 0.2;

const DRIVER_GROUPS: DriverGroup[] = [
  { label: '收益率', fields: ['annualRate'] },
  { label: '投资期限', fields: ['years'] },
  { label: '投入强度', fields: ['principal', 'recurring'] },
  { label: '费用', fields: ['feeRate'] },
];

function sameParams(a: FinanceScenario, b: FinanceScenario): boolean {
  return a.inflationRate === b.inflationRate
    && DRIVER_GROUPS.every((group) => group.fields.every((field) => a[field] === b[field]));
}

function differingGroupLabels(a: FinanceScenario, b: FinanceScenario): string[] {
  return DRIVER_GROUPS.filter((group) => group.fields.some((field) => a[field] !== b[field])).map((group) => group.label);
}

/**
 * 反事实归因：把最差情景的某一组参数替换为最优情景的取值重新推演，
 * 终值被拉近的幅度即该组参数对差距的单独贡献，最后归一化为占比。
 */
function attributeDrivers(best: FinanceScenario, worst: FinanceScenario, worstFinal: number): Array<{ label: string; share: number }> {
  const contributions = DRIVER_GROUPS.map((group) => {
    if (group.fields.every((field) => best[field] === worst[field])) return { label: group.label, amount: 0 };
    const swapped = { ...worst };
    group.fields.forEach((field) => { swapped[field] = best[field]; });
    return { label: group.label, amount: calculateProjection(swapped).finalValue - worstFinal };
  }).filter((item) => item.amount > 0);
  const total = contributions.reduce((sum, item) => sum + item.amount, 0);
  if (total <= 0) return [];
  return contributions
    .map((item) => ({ label: item.label, share: item.amount / total }))
    .sort((a, b) => b.share - a.share);
}

function formatGapPercent(gap: number, base: number): string {
  if (base <= 0) return '';
  const ratio = gap / base;
  if (ratio >= 10) return '，终值已是其 10 倍以上';
  return `，高出约 ${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`;
}

export function buildConclusion(scenarios: FinanceScenario[], projections: ScenarioProjection[]): Conclusion {
  const entries = projections
    .map((projection) => ({ projection, scenario: scenarios.find((scenario) => scenario.id === projection.scenarioId) }))
    .filter((entry): entry is RankedEntry => entry.scenario !== undefined)
    .sort((a, b) => b.projection.finalValue - a.projection.finalValue);
  const invalidCount = scenarios.length - entries.length;
  const invalidNote = invalidCount > 0 ? `另有 ${invalidCount} 个情景参数待修正，未参与本次比较。` : null;

  if (entries.length === 0) {
    return { kind: 'empty', title: '暂时没有可解读的结果', details: ['修正标红参数后，这里会自动生成对比结论。'] };
  }

  if (entries.length === 1) {
    const { scenario, projection } = entries[0];
    return {
      kind: 'single',
      title: `当前只有「${scenario.name}」一个有效情景，无法横向比较`,
      details: [
        `期末名义终值约 ¥${formatMoney(projection.finalValue)}，扣除通胀后约 ¥${formatMoney(projection.finalRealValue)}，累计投入 ¥${formatMoney(projection.totalInvested)}。`,
        invalidNote ?? '新增或复制一个情景，即可比较不同参数下的结果差异。',
      ],
    };
  }

  const best = entries[0];
  const worst = entries[entries.length - 1];

  if (entries.every((entry) => sameParams(entry.scenario, best.scenario))) {
    return {
      kind: 'identical',
      title: '各有效情景的参数完全一致，终值相同',
      details: [
        `所有情景的期末终值均约 ¥${formatMoney(best.projection.finalValue)}，当前没有可比较的差异。`,
        '试着只调整一个参数（如年化收益或投资年限），观察结果如何分叉。',
        ...(invalidNote ? [invalidNote] : []),
      ],
    };
  }

  const gap = best.projection.finalValue - worst.projection.finalValue;
  const relativeGap = best.projection.finalValue > 0 ? gap / best.projection.finalValue : 0;

  if (relativeGap < CLOSE_THRESHOLD) {
    const differing = differingGroupLabels(best.scenario, worst.scenario);
    const inflationDiffers = entries.some((entry) => entry.scenario.inflationRate !== best.scenario.inflationRate);
    return {
      kind: 'close',
      title: '各情景终值非常接近，差异不显著',
      details: [
        `最高的「${best.scenario.name}」约 ¥${formatMoney(best.projection.finalValue)}，最低的「${worst.scenario.name}」约 ¥${formatMoney(worst.projection.finalValue)}，相差仅 ¥${formatMoney(gap)}（约 ${(relativeGap * 100).toFixed(2)}%）。`,
        differing.length > 0
          ? `虽然${differing.join('、')}存在差异，但对终值影响有限，当前几个方案基本等价。`
          : '在当前假设下，几个方案基本等价，微调参数不会改变这一判断。',
        ...(inflationDiffers ? ['注意各情景通胀假设不同，扣除通胀后的实际购买力仍有差别。'] : []),
        ...(invalidNote ? [invalidNote] : []),
      ],
    };
  }

  const leaders = entries.filter((entry) => Math.round(entry.projection.finalValue) === Math.round(best.projection.finalValue));
  const leadNames = leaders.map((entry) => `「${entry.scenario.name}」`).join('、');
  const drivers = attributeDrivers(best.scenario, worst.scenario, worst.projection.finalValue);
  const secondary = drivers.length > 1 && drivers[1].share >= SECONDARY_DRIVER_THRESHOLD ? drivers[1] : null;
  const driverLine = drivers.length > 0
    ? `差距主要来自${drivers[0].label}（贡献约 ${Math.round(drivers[0].share * 100)}%）${secondary ? `，其次是${secondary.label}（约 ${Math.round(secondary.share * 100)}%）` : ''}。`
    : `差距由${differingGroupLabels(best.scenario, worst.scenario).join('、')}的交互作用共同造成，难以归因到单一因素。`;

  return {
    kind: 'ranked',
    title: leaders.length > 1
      ? `${leadNames} 并列最高，约 ¥${formatMoney(best.projection.finalValue)}`
      : `「${best.scenario.name}」终值最高，约 ¥${formatMoney(best.projection.finalValue)}`,
    details: [
      `比最低的「${worst.scenario.name}」（约 ¥${formatMoney(worst.projection.finalValue)}）多 ¥${formatMoney(gap)}${formatGapPercent(gap, worst.projection.finalValue)}。`,
      driverLine,
      `扣除通胀后，领先方案的终值约 ¥${formatMoney(best.projection.finalRealValue)}。`,
      ...(invalidNote ? [invalidNote] : []),
    ],
  };
}
