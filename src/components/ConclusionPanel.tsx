import type { ScenarioConclusion } from '../conclusion';

interface Props { conclusion: ScenarioConclusion }

/** 结果区的可读结论卡片：只负责渲染，结论文案由 buildConclusion 实时生成。 */
export function ConclusionPanel({ conclusion }: Props) {
  if (conclusion.kind === 'none') return null;

  const badge = {
    single: '单一情景',
    identical: '参数相同',
    insignificant: '差异不显著',
    comparison: '自动结论',
  }[conclusion.kind];

  return (
    <div className={`conclusion-panel conclusion-panel--${conclusion.kind}`}>
      <div className="conclusion-badge"><span>✦</span>{badge}</div>
      <div className="conclusion-body">
        {conclusion.sentences.map((sentence, index) => <p key={index}>{sentence}</p>)}
      </div>
    </div>
  );
}
