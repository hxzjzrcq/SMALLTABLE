import { formatAbilityScore } from '@dndroll/core';
import type { PanelProps } from './panels';
import { t } from '../i18n';

export function ExceptionalPanel({ view, locale, run }: PanelProps) {
  const e = view.exceptionalStrength;
  if (!e) return null;
  return (
    <section className="panel exceptional-panel" aria-label={t('exceptionalTitle', locale)}>
      <h3>
        {t('exceptionalTitle', locale)} ·{' '}
        <span className="mono">{formatAbilityScore('STR', 18, e.value)}</span>
      </h3>
      {e.mode === 'roll' && e.canRoll && (
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => run({ type: 'rollExceptional' })}
        >
          {t('rollExceptional', locale)}
        </button>
      )}
      {e.mode === 'automatic' && e.value !== null && <p>{t('exceptionalAutomatic', locale)}</p>}
      {e.mode === 'purchase' && (
        <label className="field">
          {t('buyExceptional', locale)}
          <select
            aria-label={t('buyExceptional', locale)}
            value={e.value ?? 0}
            disabled={!e.canPurchase}
            onChange={(event) =>
              run({ type: 'buyExceptional', percent: Number(event.target.value) })
            }
          >
            {Array.from({ length: 11 }, (_, i) => i * 10).map((percent) => (
              <option key={percent} value={percent}>
                {percent === 0
                  ? '18 (+0)'
                  : `${formatAbilityScore('STR', 18, percent)} (+${percent / 10})`}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="panel-hint">{t('exceptionalConvention', locale)}</p>
    </section>
  );
}
