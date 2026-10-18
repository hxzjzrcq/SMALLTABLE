import { getAbilityDisplay } from '@dndroll/core';
import { formatAbilityScore } from '@dndroll/core';
import { useMemo, useState } from 'react';
import {
  RuleError,
  deserializeSession,
  exportResult,
  formatResult,
  serializeSession,
  type Locale,
  type Session,
  type SessionView,
} from '@dndroll/core';
import { getAbilityName, t } from '../i18n';
import { AbilityModifier, Modal, Notices } from './common';
import { DieFace } from './DieFace';

function download(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- 已完成：结果与导出 ---------- */

export function CompletePanel({
  session,
  view,
  locale,
  onNew,
}: {
  session: Session;
  view: SessionView;
  locale: Locale;
  onNew?: () => void;
}) {
  const result = useMemo(() => exportResult(session), [session]);
  const text = useMemo(() => formatResult(session, locale), [session, locale]);
  const [copyState, setCopyState] = useState<'ok' | 'fail' | null>(null);
  const [showText, setShowText] = useState(false);

  const copy = async () => {
    setCopyState(null);
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no-clipboard');
      await navigator.clipboard.writeText(text);
      setCopyState('ok');
    } catch {
      // file:// 下剪贴板常被禁止：如实告知并提供可选中文本 + 下载
      setCopyState('fail');
      setShowText(true);
    }
  };

  const hasAdjust = view.attempt.trades.length > 0;

  return (
    <section className="panel complete-panel">
      <h3 className="panel-subhead">{t('resultTitle', locale)}</h3>
      <div className="final-grid">
        {view.version.order.map((ab) => {
          const base = result.baseScores[ab];
          const adj = result.adjustedScores[ab];
          const changed = base !== adj;
          return (
            <div key={ab} className={`final-cell${changed ? ' changed' : ''}`}>
              <span className="ability-abbr">{getAbilityDisplay(view.version.id, ab).id}</span>
              <span className="ability-full">{getAbilityName(view.version.id, ab, locale)}</span>
              <span className="mono final-score">
                {formatAbilityScore(ab, adj, result.exceptionalStrength)}
              </span>
              <AbilityModifier versionId={view.version.id} score={adj} locale={locale} />
              {changed && (
                <span className="mono final-base">
                  {t('baseScores', locale)} {base}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {result.selectedClass && (
        <p className="final-class">
          {t('selectedClass', locale)}:{' '}
          {view.classOptions.find((c) => c.id === result.selectedClass)?.name[locale] ??
            result.selectedClass}
          {hasAdjust &&
            ` · ${view.attempt.trades.map((tr) => `${tr.from}−2→${tr.to}+1`).join(', ')}`}
        </p>
      )}
      <Notices notices={result.notices} locale={locale} />
      <p className="final-source mono">
        {t('source', locale)}: {result.source.title}, {result.source.location}
      </p>

      {view.previousAttempts.length > 0 && (
        <details className="attempts">
          <summary>
            {t('previousAttempts', locale)}{' '}
            <span className="mono">({view.previousAttempts.length})</span>
          </summary>
          {view.previousAttempts.map((a) => (
            <div key={a.number} className="attempt">
              <h4>{t('attempt', locale, { n: a.number })}</h4>
              <ul>
                {a.candidates.map((c) => (
                  <li key={c.id} className="mono">
                    {c.id}
                    {c.ability ? ` ${getAbilityDisplay(view.version.id, c.ability).id}` : ''}:{' '}
                    {c.dice.map((d) => (d.kept ? d.value : `[${d.value}]`)).join('+') || '—'} ={' '}
                    {c.total}
                  </li>
                ))}
                {a.looseDice.map((d) => (
                  <li key={d.id} className="mono">
                    {d.id}: {d.value} → {a.allocations[d.id] ?? '—'}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}

      <div className="export-bar">
        <button type="button" className="btn" onClick={copy}>
          {t('copyResult', locale)}
        </button>
        <button type="button" className="btn" onClick={() => download('dndroll-result.txt', text)}>
          {t('downloadTxt', locale)}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            download('dndroll-session.json', serializeSession(session), 'application/json')
          }
        >
          {t('exportJson', locale)}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            download(
              'dndroll-result.json',
              JSON.stringify(exportResult(session), null, 2),
              'application/json',
            )
          }
        >
          {t('exportResultJson', locale)}
        </button>
        {onNew && (
          <button type="button" className="btn btn-primary" onClick={onNew}>
            {t('newSession', locale)}
          </button>
        )}
      </div>
      {copyState && (
        <p className={`copy-msg${copyState === 'fail' ? ' warn' : ' ok'}`} role="status">
          {copyState === 'ok' ? t('copyOk', locale) : t('copyFail', locale)}
        </p>
      )}
      <button type="button" className="btn btn-ghost" onClick={() => setShowText(!showText)}>
        {showText ? t('hideText', locale) : t('showText', locale)}
      </button>
      {showText && (
        <textarea
          className="result-text mono"
          readOnly
          rows={14}
          value={text}
          onFocus={(e) => e.currentTarget.select()}
          aria-label={t('diceDetail', locale)}
        />
      )}
    </section>
  );
}

/* ---------- 导出存档（进行中也可用） ---------- */

export function ExportSaveButton({
  session,
  locale,
  filename = 'dndroll-session.json',
}: {
  session: Session;
  locale: Locale;
  filename?: string;
}) {
  return (
    <button
      type="button"
      className="btn"
      onClick={() => download(filename, serializeSession(session), 'application/json')}
    >
      {t('exportJson', locale)}
    </button>
  );
}

/* ---------- 导入存档 ---------- */

export function ImportModal({
  locale,
  onClose,
  onRestore,
}: {
  locale: Locale;
  onClose: () => void;
  onRestore: (s: Session) => void;
}) {
  const [text, setText] = useState('');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);

  const restore = (json: string) => {
    try {
      onRestore(deserializeSession(json));
      onClose();
    } catch (e) {
      if (e instanceof RuleError) setError({ code: e.code, message: e.messages[locale] });
      else setError({ code: 'UNKNOWN', message: String(e) });
    }
  };

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    restore(await f.text());
  };

  return (
    <Modal locale={locale} title={t('importTitle', locale)} onClose={onClose} wide>
      <p className="panel-hint">{t('importHint', locale)}</p>
      <input
        type="file"
        accept="application/json,.json"
        aria-label={t('importFile', locale)}
        onChange={(e) => void pickFile(e.target.files?.[0])}
      />
      <textarea
        className="mono import-text"
        rows={10}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='{"schemaVersion":1,…}'
      />
      {error && (
        <p className="issue issue-error" role="alert">
          {t('importFail', locale)} · {error.code}: {error.message}
        </p>
      )}
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onClose}>
          {t('cancel', locale)}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!text.trim()}
          onClick={() => restore(text)}
        >
          {t('importDo', locale)}
        </button>
      </div>
    </Modal>
  );
}

export function DiceInline({
  values,
  dropped,
  locale,
}: {
  locale: Locale;
  values: number[];
  dropped?: boolean[];
}) {
  return (
    <span className="dice-row">
      {values.map((v, i) => (
        <DieFace locale={locale} key={i} value={v} dropped={dropped?.[i]} size={24} />
      ))}
    </span>
  );
}
