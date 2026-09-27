import { describe, expect, it } from 'vitest';
import { buildConclusion } from '../conclusion';
import { calculateProjection, SAMPLE_SCENARIOS } from '../domain';
import type { FinanceScenario } from '../types';

function projectAll(scenarios: FinanceScenario[]) {
  return scenarios.map((scenario) => calculateProjection(scenario));
}

describe('buildConclusion', () => {
  it('ranks the highest scenario and attributes the gap to its driver', () => {
    const conclusion = buildConclusion(SAMPLE_SCENARIOS, projectAll(SAMPLE_SCENARIOS));
    expect(conclusion.kind).toBe('ranked');
    expect(conclusion.title).toContain('长期增长');
    const text = conclusion.details.join('');
    expect(text).toContain('稳健积累');
    expect(text).toContain('收益率');
  });

  it('attributes the gap to investment duration when only years differ', () => {
    const scenarios: FinanceScenario[] = [
      { ...SAMPLE_SCENARIOS[0], id: 'a', name: '短期' },
      { ...SAMPLE_SCENARIOS[0], id: 'b', name: '长期', years: 35 },
    ];
    const conclusion = buildConclusion(scenarios, projectAll(scenarios));
    expect(conclusion.kind).toBe('ranked');
    expect(conclusion.title).toContain('长期');
    expect(conclusion.details.join('')).toContain('投资期限');
  });

  it('attributes the gap to fees and contribution intensity respectively', () => {
    const feeScenarios: FinanceScenario[] = [
      { ...SAMPLE_SCENARIOS[0], id: 'a', name: '高费', feeRate: 2 },
      { ...SAMPLE_SCENARIOS[0], id: 'b', name: '低费', feeRate: 0 },
    ];
    expect(buildConclusion(feeScenarios, projectAll(feeScenarios)).details.join('')).toContain('费用');

    const investScenarios: FinanceScenario[] = [
      { ...SAMPLE_SCENARIOS[0], id: 'a', name: '轻投入', recurring: 500 },
      { ...SAMPLE_SCENARIOS[0], id: 'b', name: '重投入', recurring: 3000 },
    ];
    expect(buildConclusion(investScenarios, projectAll(investScenarios)).details.join('')).toContain('投入强度');
  });

  it('reports an insignificant difference instead of a ranking when finals are close', () => {
    const scenarios: FinanceScenario[] = [
      { ...SAMPLE_SCENARIOS[0], id: 'a', name: '方案 A', annualRate: 4.5 },
      { ...SAMPLE_SCENARIOS[0], id: 'b', name: '方案 B', annualRate: 4.52 },
    ];
    const conclusion = buildConclusion(scenarios, projectAll(scenarios));
    expect(conclusion.kind).toBe('close');
    expect(conclusion.title).toContain('差异不显著');
  });

  it('explains instead of ranking when only one scenario is valid', () => {
    const conclusion = buildConclusion([SAMPLE_SCENARIOS[0]], projectAll([SAMPLE_SCENARIOS[0]]));
    expect(conclusion.kind).toBe('single');
    expect(conclusion.title).toContain('稳健积累');
    expect(conclusion.title).not.toContain('最高');
  });

  it('explains instead of ranking when all scenarios share identical params', () => {
    const scenarios: FinanceScenario[] = [
      { ...SAMPLE_SCENARIOS[0], id: 'a', name: '方案 A' },
      { ...SAMPLE_SCENARIOS[0], id: 'b', name: '方案 B' },
    ];
    const conclusion = buildConclusion(scenarios, projectAll(scenarios));
    expect(conclusion.kind).toBe('identical');
    expect(conclusion.title).toContain('完全一致');
  });

  it('notes scenarios left out of the comparison due to invalid params', () => {
    const scenarios: FinanceScenario[] = [
      SAMPLE_SCENARIOS[0],
      { ...SAMPLE_SCENARIOS[1], id: 'broken', name: '待修正', years: 99 },
    ];
    const valid = [SAMPLE_SCENARIOS[0]];
    const conclusion = buildConclusion(scenarios, projectAll(valid));
    expect(conclusion.kind).toBe('single');
    expect(conclusion.details.join('')).toContain('1 个情景参数待修正');
  });

  it('reflects the current scenario set instead of stale wording', () => {
    const initial = buildConclusion(SAMPLE_SCENARIOS, projectAll(SAMPLE_SCENARIOS));
    expect(initial.title).toContain('长期增长');
    const remaining = SAMPLE_SCENARIOS.filter((scenario) => scenario.id !== 'growth');
    const updated = buildConclusion(remaining, projectAll(remaining));
    expect(updated.title).toContain('平衡增长');
    expect([updated.title, ...updated.details].join('')).not.toContain('长期增长');
  });
});
