import { describe, expect, it } from 'vitest';
import { SAMPLE_SCENARIOS, calculateProjection } from '../domain';
import { buildConclusion } from '../conclusion';
import type { FinanceScenario } from '../types';

function projectionsOf(scenarios: FinanceScenario[]) {
  return scenarios.map((scenario) => calculateProjection(scenario));
}

function makeScenario(overrides: Partial<FinanceScenario> = {}): FinanceScenario {
  return { id: 'a', name: '方案A', color: '#000', principal: 30000, recurring: 1500, years: 20, annualRate: 5, inflationRate: 2, feeRate: 0.5, ...overrides };
}

describe('buildConclusion', () => {
  it('returns none when there are no valid projections', () => {
    const conclusion = buildConclusion(SAMPLE_SCENARIOS, []);
    expect(conclusion.kind).toBe('none');
    expect(conclusion.sentences).toEqual([]);
  });

  it('explains a single valid scenario instead of fabricating a ranking', () => {
    const scenarios = [makeScenario()];
    const conclusion = buildConclusion(scenarios, projectionsOf(scenarios));
    expect(conclusion.kind).toBe('single');
    expect(conclusion.sentences[0]).toContain('只有 1 个有效情景');
    expect(conclusion.sentences[0]).toContain('方案A');
    expect(conclusion.sentences[0]).not.toContain('最高');
  });

  it('states that identical parameters produce no comparable difference', () => {
    const a = makeScenario();
    const b = makeScenario({ id: 'b', name: '方案B', color: '#fff' });
    const conclusion = buildConclusion([a, b], projectionsOf([a, b]));
    expect(conclusion.kind).toBe('identical');
    expect(conclusion.sentences[0]).toContain('参数完全相同');
  });

  it('flags small gaps as insignificant with the actual gap', () => {
    const a = makeScenario({ annualRate: 5 });
    const b = makeScenario({ id: 'b', name: '方案B', color: '#fff', annualRate: 5.05 });
    const projections = projectionsOf([a, b]);
    const gap = Math.abs(projections[0].finalValue - projections[1].finalValue) / Math.max(...projections.map((p) => p.finalValue));
    expect(gap).toBeLessThan(0.02);

    const conclusion = buildConclusion([a, b], projections);
    expect(conclusion.kind).toBe('insignificant');
    expect(conclusion.sentences[0]).toContain('差异不显著');
  });

  it('names the top and bottom scenarios with the gap for a real comparison', () => {
    const low = makeScenario({ id: 'low', name: '保守', annualRate: 3 });
    const high = makeScenario({ id: 'high', name: '激进', color: '#286f68', annualRate: 8 });
    const conclusion = buildConclusion([low, high], projectionsOf([low, high]));
    expect(conclusion.kind).toBe('comparison');
    expect(conclusion.sentences[0]).toContain('终值最高的是「激进」');
    expect(conclusion.sentences[0]).toContain('最低的是「保守」');
    expect(conclusion.sentences[0]).toContain('相差约');
    expect(conclusion.sentences.some((text) => text.includes('年化收益更高'))).toBe(true);
  });

  it('attributes longer horizon and heavier contributions to the gap', () => {
    const short = makeScenario({ id: 'short', name: '短期', years: 10, recurring: 1000 });
    const long = makeScenario({ id: 'long', name: '长期', color: '#286f68', years: 30, recurring: 3000, annualRate: 5 });
    const conclusion = buildConclusion([short, long], projectionsOf([short, long]));
    expect(conclusion.kind).toBe('comparison');
    const drivers = conclusion.sentences[1];
    expect(drivers).toContain('投资期限更长（10 年 → 30 年）');
    expect(drivers).toContain('每月投入更多');
  });

  it('recognizes lower fees as a driver', () => {
    const costly = makeScenario({ id: 'c', name: '高费', annualRate: 7, feeRate: 1.5 });
    const cheap = makeScenario({ id: 'h', name: '低费', color: '#286f68', annualRate: 7, feeRate: 0.1 });
    const conclusion = buildConclusion([costly, cheap], projectionsOf([costly, cheap]));
    expect(conclusion.kind).toBe('comparison');
    expect(conclusion.sentences.some((text) => text.includes('费用更低（1.5% → 0.1%）'))).toBe(true);
  });

  it('recognizes bigger initial principal as a driver', () => {
    const small = makeScenario({ id: 's', name: '小本金', principal: 10000, recurring: 0 });
    const big = makeScenario({ id: 'b', name: '大本金', color: '#286f68', principal: 200000, recurring: 0 });
    const conclusion = buildConclusion([small, big], projectionsOf([small, big]));
    expect(conclusion.kind).toBe('comparison');
    expect(conclusion.sentences.some((text) => text.includes('初始投入更高'))).toBe(true);
  });

  it('notes when higher inflation reverses the real-value ranking', () => {
    const nominalWinner = makeScenario({ id: 'w', name: '名义领先', annualRate: 8, inflationRate: 5 });
    const realWinner = makeScenario({ id: 'r', name: '实际领先', color: '#286f68', annualRate: 5.5, inflationRate: 0 });
    const projections = projectionsOf([nominalWinner, realWinner]);
    const byNominal = [...projections].sort((p, q) => q.finalValue - p.finalValue)[0];
    const byReal = [...projections].sort((p, q) => q.finalRealValue - p.finalRealValue)[0];
    expect(byNominal.scenarioId).toBe('w');
    expect(byReal.scenarioId).toBe('r');

    const conclusion = buildConclusion([nominalWinner, realWinner], projections);
    expect(conclusion.sentences.some((text) => text.includes('扣除通胀后') && text.includes('「实际领先」'))).toBe(true);
  });

  it('recomputes wording when parameters change rather than keeping stale text', () => {
    const low = makeScenario({ id: 'low', name: '保守', annualRate: 3 });
    const high = makeScenario({ id: 'high', name: '激进', color: '#286f68', annualRate: 8 });
    const first = buildConclusion([low, high], projectionsOf([low, high]));
    expect(first.sentences[0]).toContain('终值最高的是「激进」');

    const aligned = { ...high, annualRate: 3 };
    const second = buildConclusion([low, aligned], projectionsOf([low, aligned]));
    expect(second.kind).toBe('identical');
    expect(second.sentences[0]).not.toContain('激进');

    const single = buildConclusion([low], projectionsOf([low]));
    expect(single.kind).toBe('single');
  });

  it('produces a sensible comparison for the built-in sample scenarios', () => {
    const conclusion = buildConclusion(SAMPLE_SCENARIOS, projectionsOf(SAMPLE_SCENARIOS));
    expect(conclusion.kind).toBe('comparison');
    expect(conclusion.sentences[0]).toContain('终值最高的是');
    // 高收益方案同时承担更高费用，结论应如实点出费用上的抵消作用
    expect(conclusion.sentences.join(' ')).toContain('年化收益更高');
  });
});
