import { dccAbilityModifier, getAbilityDisplay } from '@dndroll/core';
import { useEffect, useRef, type ReactNode } from 'react';
import type {
  Ability,
  Candidate,
  Issue,
  Locale,
  SessionView,
  Text,
  VersionId,
} from '@dndroll/core';
import { getAbilityName, t } from '../i18n';
import { DieFace } from './DieFace';

export function AbilityName({
  versionId,
  ability,
  locale,
}: {
  versionId: VersionId;
  ability: Ability;
  locale: Locale;
}) {
  return (
    <span className="ability-name">
      <span className="ability-abbr">{getAbilityDisplay(versionId, ability).id}</span>
      <span className="ability-full">{getAbilityName(versionId, ability, locale)}</span>
    </span>
  );
}

/** 单组骰子：保留骰实心，舍弃骰空心带斜线，后缀显示总和。 */
export function DiceRow({
  candidate,
  locale,
  size = 30,
}: {
  candidate: Candidate;
  locale: Locale;
  size?: number;
}) {
  if (candidate.dice.length === 0) return null;
  return (
    <span className="dice-row">
      {candidate.dice.map((d) => (
        <DieFace locale={locale} key={d.id} value={d.value} dropped={!d.kept} size={size} />
      ))}
    </span>
  );
}

export function CandidateFace({ candidate, locale }: { candidate: Candidate; locale: Locale }) {
  return (
    <span className="candidate-face">
      <DiceRow locale={locale} candidate={candidate} />
      <span className="candidate-total">
        <span className="mono">{candidate.total}</span>
        {candidate.dice.some((d) => !d.kept) && (
          <span className="candidate-dropped-note">
            {t('dropped', locale)}{' '}
            {candidate.dice
              .filter((d) => !d.kept)
              .map((d) => d.value)
              .join(', ')}
          </span>
        )}
      </span>
    </span>
  );
}

export function Notices({ notices, locale }: { notices: Text[]; locale: Locale }) {
  if (notices.length === 0) return null;
  return (
    <div className="notices" role="note">
      <span className="notices-label">{t('notices', locale)}</span>
      <ul>
        {notices.map((n, i) => (
          <li key={i}>{n[locale]}</li>
        ))}
      </ul>
    </div>
  );
}

export function Issues({ issues, locale }: { issues: Issue[]; locale: Locale }) {
  if (issues.length === 0) return null;
  return (
    <ul className="issues" aria-live="polite">
      {issues.map((i) => (
        <li key={i.code} className={`issue issue-${i.severity}`}>
          {i.message[locale]}
        </li>
      ))}
    </ul>
  );
}

export function Modal({
  title,
  locale,
  onClose,
  children,
  wide = false,
}: {
  locale: Locale;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
      >
        <div className="modal-head">
          <h2>{title}</h2>
          <button
            type="button"
            className="btn btn-ghost modal-close"
            onClick={onClose}
            aria-label={t('close', locale)}
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  locale,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  locale: Locale;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal locale={locale} title={title} onClose={onCancel}>
      <p className="modal-body-text">{body}</p>
      <div className="modal-actions">
        <button type="button" className="btn" onClick={onCancel}>
          {t('cancel', locale)}
        </button>
        <button type="button" className="btn btn-danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

/** 阶段指示条。 */
export function PhaseSteps({ view, locale }: { view: SessionView; locale: Locale }) {
  const mode = view.method.mode;
  const steps: { key: string; label: string }[] = [];
  if (mode === 'pool') steps.push({ key: 'configure', label: t('stepConfigure', locale) });
  if (view.method.randomBudget || !['buy', 'array'].includes(mode))
    steps.push({ key: 'roll', label: t('stepRoll', locale) });
  const hasAssignStep =
    ['assign', 'best-six', 'array', 'pairs', 'sets', 'allocate', 'buy'].includes(mode) &&
    !(mode === 'assign' && view.options.inOrder);
  if (hasAssignStep) steps.push({ key: 'assign', label: t('stepAssign', locale) });
  steps.push(
    { key: 'review', label: t('stepReview', locale) },
    { key: 'done', label: t('stepDone', locale) },
  );

  const phase = view.phase;
  const stateOf = (key: string): 'done' | 'now' | 'todo' => {
    if (phase === 'complete') return 'done';
    switch (key) {
      case 'configure':
        return view.attempt.generated ? 'done' : 'now';
      case 'roll':
        return view.attempt.generated ? 'done' : 'now';
      case 'assign':
        if (!view.attempt.generated) return 'todo';
        return phase === 'review' ? 'done' : 'now';
      case 'review':
        return phase === 'review' ? 'now' : 'todo';
      default:
        return 'todo';
    }
  };
  return (
    <ol className="phase-steps">
      {steps.map((s) => (
        <li key={s.key} className={`step step-${stateOf(s.key)}`}>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

/** Only DCC gains modifier display in this release. */
export function AbilityModifier({
  versionId,
  score,
  locale,
}: {
  versionId: VersionId;
  score: number | undefined;
  locale: Locale;
}) {
  if (versionId !== 'dcc' || score === undefined) return null;
  const modifier = dccAbilityModifier(score);
  const label = `${modifier > 0 ? '+' : ''}${modifier}`;
  return (
    <span className="ability-modifier mono" aria-label={`${t('modifier', locale)} ${label}`}>
      ({label})
    </span>
  );
}
