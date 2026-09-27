import type { Conclusion, ConclusionKind } from '../conclusion';

const ICONS: Record<ConclusionKind, string> = {
  empty: '⌁',
  single: 'ⓘ',
  identical: '＝',
  close: '≈',
  ranked: '✦',
};

interface Props { conclusion: Conclusion }

export function ConclusionCard({ conclusion }: Props) {
  return (
    <div className={`conclusion-card conclusion-card--${conclusion.kind}`}>
      <span className="conclusion-card__icon" aria-hidden="true">{ICONS[conclusion.kind]}</span>
      <div className="conclusion-card__body">
        <strong>{conclusion.title}</strong>
        {conclusion.details.map((line) => <p key={line}>{line}</p>)}
      </div>
    </div>
  );
}
