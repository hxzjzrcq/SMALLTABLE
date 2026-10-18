import { useState } from 'react';
import type { Ability, ClassId } from '@dndroll/core';
import { t } from '../i18n';
import { Modal } from './common';
import type { PanelProps } from './panels';

/** B/X 与 OSE 的职业选择和主属性交换。 */
export function ClassPanel({ view, locale, run }: PanelProps) {
  const [from, setFrom] = useState<Ability | ''>('');
  const [to, setTo] = useState<Ability | ''>('');
  const selected = view.attempt.selectedClass;
  const cls = view.classOptions.find((c) => c.id === selected);

  const minimumsText = (c: (typeof view.classOptions)[number]) => {
    const entries = Object.entries(c.minimums);
    if (entries.length === 0) return '—';
    return entries.map(([a, v]) => `${a}≥${v}`).join(' ');
  };

  return (
    <section className="panel class-panel">
      <h3 className="panel-subhead">{t('classTitle', locale)}</h3>
      <p className="panel-hint">{t('classResetNote', locale)}</p>
      <div className="class-grid" role="radiogroup" aria-label={t('selectedClass', locale)}>
        <button
          type="button"
          role="radio"
          aria-checked={selected === null}
          className={`class-card${selected === null ? ' chosen' : ''}`}
          onClick={() => run({ type: 'selectClass', classId: null })}
        >
          <span className="class-name">{t('classNone', locale)}</span>
        </button>
        {view.classOptions.map((c) => (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={selected === c.id}
            className={`class-card${selected === c.id ? ' chosen' : ''}`}
            onClick={() => run({ type: 'selectClass', classId: c.id as ClassId })}
          >
            <span className="class-name">{c.name[locale]}</span>
            <span className="class-min mono">
              {t('classMinimums', locale)}: {minimumsText(c)}
            </span>
          </button>
        ))}
      </div>

      {cls && (
        <div className="trade-box">
          <div className="trade-controls">
            <label>
              {t('tradeFrom', locale)}
              <select value={from} onChange={(e) => setFrom(e.target.value as Ability | '')}>
                <option value="">—</option>
                {cls.donors.map((a) => (
                  <option key={a} value={a}>
                    {a} ({view.attempt.scores[a]})
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t('tradeTo', locale)}
              <select value={to} onChange={(e) => setTo(e.target.value as Ability | '')}>
                <option value="">—</option>
                {cls.targets.map((a) => (
                  <option key={a} value={a}>
                    {a} ({view.attempt.scores[a]})
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn"
              disabled={!from || !to}
              onClick={() => {
                if (from && to && run({ type: 'trade', from, to })) {
                  setFrom('');
                  setTo('');
                }
              }}
            >
              {t('tradeDo', locale)}
            </button>
          </div>
          {view.attempt.trades.length > 0 && (
            <ul className="trade-log">
              {view.attempt.trades.map((tr, i) => (
                <li key={i} className="mono">
                  {tr.from} −2 → {tr.to} +1
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="btn btn-ghost"
            disabled={view.attempt.trades.length === 0}
            onClick={() => run({ type: 'resetAdjustments' })}
          >
            {t('tradeReset', locale)}
          </button>
        </div>
      )}
    </section>
  );
}

/** 重掷入口：3.5 规则重掷 + B/X/OSE 主持人许可重建。 */
export function RerollBar({ view, locale, run }: PanelProps) {
  const [showReferee, setShowReferee] = useState(false);
  const [note, setNote] = useState('');
  if (!view.canRuleReroll && !view.canRefereeReroll) return null;
  return (
    <section className="panel reroll-bar">
      {view.canRuleReroll && (
        <button
          type="button"
          className="btn"
          onClick={() => run({ type: 'reroll', reason: 'rule' })}
        >
          {t('rerollRule', locale)}
        </button>
      )}
      {view.canRefereeReroll && (
        <button type="button" className="btn" onClick={() => setShowReferee(true)}>
          {t('rerollReferee', locale)}
        </button>
      )}
      {showReferee && (
        <Modal
          locale={locale}
          title={t('rerollReferee', locale)}
          onClose={() => setShowReferee(false)}
        >
          <label className="field">
            {t('refereeNote', locale)}
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder={t('refereeNotePlaceholder', locale)}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={() => setShowReferee(false)}>
              {t('cancel', locale)}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!note.trim()}
              onClick={() => {
                if (run({ type: 'reroll', reason: 'referee', note: note.trim() })) {
                  setShowReferee(false);
                  setNote('');
                }
              }}
            >
              {t('rerollDo', locale)}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/** 完成确认条。 */
export function FinalizeBar({ view, locale, run }: PanelProps) {
  const [accept, setAccept] = useState(false);
  if (!view.canFinalize) return null;
  const needAccept = view.pointBuy !== null && view.pointBuy.remaining > 0;
  return (
    <section className="panel finalize-bar">
      {needAccept && (
        <label className="check">
          <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
          {t('acceptUnspent', locale)}
        </label>
      )}
      <button
        type="button"
        className="btn btn-primary"
        disabled={needAccept && !accept}
        onClick={() => run({ type: 'finalize', ...(needAccept ? { acceptUnspent: true } : {}) })}
      >
        {t('finalize', locale)}
      </button>
      <p className="panel-hint">{t('finalizeNote', locale)}</p>
    </section>
  );
}
