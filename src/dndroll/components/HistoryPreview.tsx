import { getAbilityDisplay, formatAbilityScore } from '@dndroll/core';
import type { Locale, SessionView } from '@dndroll/core';
import { t } from '../i18n';

/** Display Core-provided values only; never select or recalculate results. */
export function historyLines(view: SessionView, locale: Locale): string[] {
  const { attempt: a, method, version } = view;
  const scores = version.order
    .map(
      (ab) =>
        `${getAbilityDisplay(version.id, ab).id} ${formatAbilityScore(ab, a.scores[ab], a.exceptionalStrength)}`,
    )
    .join(' · ');
  const lines: string[] = [];
  if (a.pointGeneration)
    lines.push(
      `${t('budget', locale)} ${a.pointGeneration.budget} · ${t('scoreCap', locale)} ${a.pointGeneration.maximum}`,
    );
  if (method.mode === 'sets') {
    const ids = [...new Set(a.candidates.map((c) => c.setId))];
    for (const [i, id] of ids.entries()) {
      lines.push(
        `${t('set', locale, { n: i + 1 })}${a.selectedSet === id ? ' ✓' : ''}: ${a.candidates
          .filter((c) => c.setId === id)
          .map((c) => c.total)
          .join(' / ')}`,
      );
    }
  } else if (method.mode === 'pairs') {
    lines.push(
      t('historyCandidates', locale) +
        ': ' +
        version.order
          .map(
            (ab) =>
              `${getAbilityDisplay(version.id, ab).id} [${a.candidates
                .filter((c) => c.ability === ab)
                .map((c) => c.total)
                .join(' / ')}]`,
          )
          .join(' · '),
    );
  } else if (method.mode === 'allocate') {
    lines.push(t('historyDice', locale) + ': ' + a.looseDice.map((d) => d.value).join(' / '));
  } else if (!['fixed', 'pool', 'buy'].includes(method.mode)) {
    lines.push(
      t('historyCandidates', locale) + ': ' + a.candidates.map((c) => c.total).join(' / '),
    );
  }
  if (Object.keys(a.scores).length) lines.push(t('historyScores', locale) + ': ' + scores);
  return lines;
}

export function HistoryPreview({ view, locale }: { view: SessionView; locale: Locale }) {
  const lines = historyLines(view, locale);
  if (view.method.mode === 'sets') {
    return (
      <details className="history-values mono">
        <summary>{t('historySets', locale)}</summary>
        {lines.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </details>
    );
  }
  return (
    <div className="history-values mono">
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}
