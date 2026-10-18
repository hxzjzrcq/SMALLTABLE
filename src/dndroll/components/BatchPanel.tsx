import { useState } from 'react';
import {
  BATCH_COUNTS,
  generateBatch,
  getAbilityMapping,
  getMethod,
  serializeSession,
  formatAbilityScore,
  isBatchMethod,
  RuleError,
  type BatchEntry,
  type CreateRequest,
  type Locale,
  type Rng,
  type Session,
  type Text,
} from '@dndroll/core';
import { AbilityName, AbilityModifier, DiceRow, Modal } from './common';
import { CompletePanel, ExportSaveButton } from './exporting';
import { t } from '../i18n';

/** Batch results live only here, independently of the single-session controller. */
export function BatchPanel({
  request,
  locale,
  rng,
  onUse,
}: {
  onUse: (session: Session) => void;
  request: CreateRequest | null;
  locale: Locale;
  rng?: Rng;
}) {
  const [selected, setSelected] = useState<BatchEntry | null>(null);
  const [count, setCount] = useState(4);
  const [entries, setEntries] = useState<BatchEntry[]>([]);
  const [error, setError] = useState<Text | null>(null);
  const eligible = request && isBatchMethod(getMethod(request.methodId), request.options);
  const generate = () => {
    if (!request || !eligible) return;
    try {
      const next = generateBatch(request, count, rng);
      setEntries(next);
      setSelected(null);
      setError(null);
    } catch (e) {
      setError(
        e instanceof RuleError
          ? e.messages
          : { zh: `批量生成失败：${String(e)}`, en: `Batch generation failed: ${String(e)}` },
      );
    }
  };
  if (!eligible && !entries.length && !error) return null;
  return (
    <section className="panel batch-panel" aria-label={t('batchTitle', locale)}>
      <h2>{t('batchTitle', locale)}</h2>
      <p className="panel-hint">{t('batchLifetime', locale)}</p>
      {eligible && request && (
        <>
          <p className="batch-method">{getMethod(request.methodId).name[locale]}</p>
          <div className="batch-controls">
            <label>
              {t('batchCount', locale)}{' '}
              <select
                aria-label={t('batchCount', locale)}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
              >
                {BATCH_COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-primary" onClick={generate}>
              {t('batchGenerate', locale)}
            </button>
          </div>
          <p className="panel-hint">{t('batchPresetHint', locale)}</p>
        </>
      )}
      {error && (
        <p className="issue issue-error" role="alert">
          {error[locale]}
          {entries.length > 0 ? ` ${t('batchPrevious', locale)}` : ''}
        </p>
      )}
      {entries.length > 0 && (
        <>
          <p role="status">{t('batchReady', locale, { n: entries.length })}</p>
          <p>
            {entries[0]!.view.version.name[locale]} · {entries[0]!.view.method.name[locale]}
          </p>
          <ol className="batch-results">
            {entries.map((entry) => (
              <li
                key={entry.index}
                className="batch-entry"
                aria-label={t('batchCharacter', locale, { n: entry.index })}
              >
                <h3>#{entry.index}</h3>
                <dl className="batch-scores">
                  {entry.view.version.order.map((slot) => (
                    <div key={slot}>
                      <dt>
                        <AbilityName
                          versionId={entry.view.version.id}
                          ability={slot}
                          locale={locale}
                        />
                      </dt>
                      <dd>
                        <span className="mono">
                          {formatAbilityScore(
                            slot,
                            entry.view.attempt.scores[slot],
                            entry.view.attempt.exceptionalStrength,
                          )}
                        </span>{' '}
                        <AbilityModifier
                          versionId={entry.view.version.id}
                          score={entry.view.attempt.scores[slot]}
                          locale={locale}
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
                <details className="batch-dice">
                  <summary>{t('diceDetail', locale)}</summary>
                  <ul>
                    {entry.view.attempt.candidates.map((candidate) => (
                      <li key={candidate.id}>
                        {candidate.ability && (
                          <AbilityName
                            versionId={entry.view.version.id}
                            ability={candidate.ability}
                            locale={locale}
                          />
                        )}
                        <DiceRow candidate={candidate} locale={locale} />
                        <span className="mono"> = {candidate.total}</span>
                        {Object.values(entry.view.attempt.assignments).includes(candidate.id) &&
                          ' ✓'}
                      </li>
                    ))}
                  </ul>
                </details>
                <div className="batch-controls">
                  <button type="button" className="btn" onClick={() => setSelected(entry)}>
                    {t('batchView', locale, { n: entry.index })}
                  </button>
                  <ExportSaveButton
                    session={entry.session}
                    locale={locale}
                    filename={`dndroll-${entry.view.version.id}-${entry.index}-session.json`}
                  />
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
      {selected && (
        <Modal
          title={`${t('batchCharacter', locale, { n: selected.index })} · ${selected.view.version.name[locale]}`}
          locale={locale}
          onClose={() => setSelected(null)}
          wide
        >
          <CompletePanel session={selected.session} view={selected.view} locale={locale} />
          <details className="batch-audit">
            <summary>{t('batchSessionJson', locale)}</summary>
            <p>
              {t('auditMapping', locale)}:{' '}
              {getAbilityMapping(selected.view.version.id)
                .map((a) => `${a.slot} → ${a.id}`)
                .join(' · ')}
            </p>
            <pre className="session-json mono">
              {JSON.stringify(JSON.parse(serializeSession(selected.session)), null, 2)}
            </pre>
          </details>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setSelected(null);
              onUse(selected.session);
            }}
          >
            {t('batchUse', locale)}
          </button>
        </Modal>
      )}
    </section>
  );
}
