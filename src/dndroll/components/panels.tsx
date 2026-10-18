import { useMemo, useState } from 'react';
import type { Ability, Action, Candidate, Locale, SessionView } from '@dndroll/core';
import { t } from '../i18n';
import { AbilityName, CandidateFace, DiceRow } from './common';
import { DieFace } from './DieFace';

export interface PanelProps {
  view: SessionView;
  locale: Locale;
  run: (action: Action) => boolean;
}

/* ---------- 掷骰 ---------- */

export function RollPanel({ view, locale, run }: PanelProps) {
  return (
    <section className="panel roll-panel">
      <p className="panel-hint">
        {t(view.method.randomBudget ? 'rollBudgetHint' : 'rollHint', locale)}
      </p>
      <button
        type="button"
        className="btn btn-primary btn-roll"
        aria-label={t('roll', locale)}
        onClick={() => run({ type: 'roll' })}
      >
        <DieFace locale={locale} value={5} size={30} />
        {t('roll', locale)}
      </button>
      {view.method.mode === 'pool' && <p className="panel-hint">{t('configureFirst', locale)}</p>}
    </section>
  );
}

/* ---------- 自由分配 / 十二取六 / 数组 ---------- */

export function AssignPanel({ view, locale, run }: PanelProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const { order } = view.version;
  const { candidates, assignments } = view.attempt;
  const byId = useMemo(() => new Map(candidates.map((c) => [c.id, c])), [candidates]);
  const isBestSix = view.method.mode === 'best-six';

  const submit = (assignmentsNext: Record<string, string>) => {
    run({ type: 'assign', assignments: assignmentsNext });
  };

  const placeOn = (ability: Ability) => {
    if (picked) {
      const next: Record<string, string> = {};
      for (const [ab, id] of Object.entries(assignments)) if (id !== picked) next[ab] = id;
      next[ability] = picked;
      submit(next);
      setPicked(null);
    } else if (assignments[ability]) {
      const next = { ...assignments };
      delete next[ability];
      submit(next);
    }
  };

  const card = (c: Candidate) => {
    const assignedTo = Object.entries(assignments).find(([, id]) => id === c.id)?.[0] as
      Ability | undefined;
    const disabled = isBestSix && !c.eligible && !assignedTo;
    return (
      <button
        key={c.id}
        type="button"
        className={`candidate${picked === c.id ? ' picked' : ''}${assignedTo ? ' used' : ''}${disabled ? ' dimmed' : ''}`}
        disabled={disabled}
        onClick={() => setPicked(picked === c.id ? null : c.id)}
        aria-pressed={picked === c.id}
      >
        <CandidateFace candidate={c} locale={locale} />
        <span className="candidate-meta">
          {isBestSix && (
            <span className={`badge ${c.eligible ? 'badge-ok' : 'badge-dim'}`}>
              {c.eligible ? t('eligible', locale) : t('notEligible', locale)}
            </span>
          )}
          {assignedTo && (
            <span className="badge badge-assigned">
              {t('assigned', locale)} → {assignedTo}
            </span>
          )}
        </span>
      </button>
    );
  };

  return (
    <section className="panel">
      <p className="panel-hint">{t('assignHint', locale)}</p>
      <div className="assign-grid">
        <div className="candidate-list" role="group" aria-label={t('candidates', locale)}>
          <h3 className="panel-subhead">{t('candidates', locale)}</h3>
          {candidates.map(card)}
        </div>
        <div className="ability-slots" role="group" aria-label={t('abilities', locale)}>
          <h3 className="panel-subhead">{t('abilities', locale)}</h3>
          {order.map((ab) => {
            const id = assignments[ab];
            const c = id ? byId.get(id) : undefined;
            return (
              <button
                key={ab}
                type="button"
                className={`ability-slot${c ? ' filled' : ''}`}
                onClick={() => placeOn(ab)}
              >
                <AbilityName versionId={view.version.id} ability={ab} locale={locale} />
                {c ? (
                  <CandidateFace candidate={c} locale={locale} />
                ) : (
                  <span className="slot-empty">{t('unassigned', locale)}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

/* ---------- 2E II：每项二选一（可选低值） ---------- */

export function PairsPanel({ view, locale, run }: PanelProps) {
  const { order } = view.version;
  const { candidates, assignments } = view.attempt;
  return (
    <section className="panel">
      <p className="panel-hint">{t('pairsHint', locale)}</p>
      <div className="pairs-list">
        {order.map((ab) => {
          const pair = candidates.filter((c) => c.ability === ab);
          const chosen = assignments[ab];
          return (
            <div key={ab} className="pair-row">
              <AbilityName versionId={view.version.id} ability={ab} locale={locale} />
              <div className="pair-options">
                {pair.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`candidate pair-option${chosen === c.id ? ' chosen' : ''}`}
                    aria-pressed={chosen === c.id}
                    onClick={() => run({ type: 'choosePair', ability: ab, candidateId: c.id })}
                  >
                    <CandidateFace candidate={c} locale={locale} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- 1E IV：十二套选一 ---------- */

export function SetsPanel({ view, locale, run }: PanelProps) {
  const { order } = view.version;
  const { candidates, selectedSet } = view.attempt;
  const sets = useMemo(() => {
    const map = new Map<string, Candidate[]>();
    for (const c of candidates) {
      if (!c.setId) continue;
      if (!map.has(c.setId)) map.set(c.setId, []);
      map.get(c.setId)!.push(c);
    }
    return [...map.entries()];
  }, [candidates]);
  return (
    <section className="panel">
      <p className="panel-hint">{t('setsHint', locale)}</p>
      <div className="sets-grid">
        {sets.map(([setId, members], i) => {
          const chosen = selectedSet === setId;
          const sum = members.reduce((a, c) => a + c.total, 0);
          return (
            <button
              key={setId}
              type="button"
              className={`set-card${chosen ? ' chosen' : ''}`}
              aria-pressed={chosen}
              onClick={() => run({ type: 'chooseSet', setId })}
            >
              <span className="set-head">
                <span>{t('set', locale, { n: i + 1 })}</span>
                <span className="mono set-sum">Σ {sum}</span>
              </span>
              {order.map((ab) => {
                const c = members.find((m) => m.ability === ab);
                return (
                  <span key={ab} className="set-line">
                    <span className="set-ability">{ab}</span>
                    <DiceRow locale={locale} candidate={c!} size={18} />
                    <span className="mono">{c?.total}</span>
                  </span>
                );
              })}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- 2E VI：七颗骰逐颗分配 ---------- */

export function AllocatePanel({ view, locale, run }: PanelProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const { order } = view.version;
  const { looseDice, allocations, baseScores } = view.attempt;
  const unplaced = looseDice.filter((d) => !allocations[d.id]);

  const place = (ability: Ability) => {
    if (!picked) return;
    const ok = run({ type: 'allocateDie', dieId: picked, ability });
    if (ok) setPicked(null);
  };
  const recall = (dieId: string) => run({ type: 'allocateDie', dieId, ability: null });

  return (
    <section className="panel">
      <p className="panel-hint">{t('allocateHint', locale)}</p>
      <div className="allocate-pool" role="group" aria-label={t('unallocated', locale)}>
        <h3 className="panel-subhead">
          {t('unallocated', locale)} <span className="mono">({unplaced.length})</span>
        </h3>
        <div className="allocate-pool-dice">
          {unplaced.map((d) => (
            <button
              key={d.id}
              type="button"
              className={`loose-die${picked === d.id ? ' picked' : ''}`}
              aria-pressed={picked === d.id}
              onClick={() => setPicked(picked === d.id ? null : d.id)}
            >
              <DieFace locale={locale} value={d.value} size={44} />
            </button>
          ))}
          {unplaced.length === 0 && <span className="slot-empty">—</span>}
        </div>
      </div>
      <div className="allocate-grid">
        {order.map((ab) => {
          const placed = looseDice.filter((d) => allocations[d.id] === ab);
          const score = baseScores[ab] ?? 8;
          return (
            <div key={ab} className={`allocate-cell${picked ? ' targetable' : ''}`}>
              <button
                type="button"
                className="allocate-cell-head allocate-place"
                disabled={!picked}
                aria-label={`${ab} · ${t('placeDie', locale)}`}
                onClick={() => place(ab)}
              >
                <AbilityName versionId={view.version.id} ability={ab} locale={locale} />
                <span className={`mono allocate-total${score >= 18 ? ' at-cap' : ''}`}>
                  {score}
                </span>
              </button>
              <div className="allocate-cell-dice">
                <span className="allocate-base mono">8</span>
                {placed.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="placed-die"
                    aria-label={`${t('recallDie', locale)} · ${ab} · d6 ${d.value} · ${d.id}`}
                    onClick={() => recall(d.id)}
                  >
                    <DieFace locale={locale} value={d.value} size={36} />
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- PF1 骰池：掷前分骰 ---------- */

export function PoolPanel({ view, locale, run }: PanelProps) {
  const total = view.options.poolTotal ?? 24;
  const maxDice = view.method.poolMax ?? total;
  const committed = view.attempt.poolCounts;
  const [draft, setDraft] = useState<Record<Ability, number>>(() => ({ ...committed }));
  const draftSum = Object.values(draft).reduce((a, b) => a + b, 0);
  const dirty = view.version.order.some((ab) => draft[ab] !== committed[ab]);
  const ready = draftSum === total;

  const bump = (ab: Ability, delta: number) => {
    const next = { ...draft, [ab]: draft[ab] + delta };
    if (next[ab] < 3 || next[ab] > maxDice) return;
    setDraft(next);
  };

  return (
    <section className="panel">
      <p className="panel-hint">{t(view.method.poolMax ? 'poolHint2e' : 'poolHint', locale)}</p>
      <div className="pool-grid">
        {view.version.order.map((ab) => (
          <div key={ab} className="pool-row">
            <AbilityName versionId={view.version.id} ability={ab} locale={locale} />
            <div className="stepper">
              <button
                type="button"
                className="btn btn-step"
                disabled={draft[ab] <= 3}
                onClick={() => bump(ab, -1)}
                aria-label={`${ab} -1`}
              >
                −
              </button>
              <span className="mono stepper-value">{draft[ab]}d6</span>
              <button
                type="button"
                className="btn btn-step"
                disabled={draft[ab] >= maxDice}
                onClick={() => bump(ab, 1)}
                aria-label={`${ab} +1`}
              >
                +
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="pool-status">
        <span className={`mono pool-sum${ready ? ' ok' : ' bad'}`}>
          {draftSum} / {total}
        </span>
        <span className="pool-note">
          {t('poolEach3', locale)}
          {dirty && ` · ${t('poolDirty', locale)}`}
          {!dirty && ready && ` · ${t('poolCommitted', locale)}`}
        </span>
      </div>
      <div className="pool-actions">
        <button
          type="button"
          className="btn"
          disabled={!ready || !dirty}
          onClick={() => run({ type: 'setPool', counts: { ...draft } })}
        >
          {t('confirmConfig', locale)}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          aria-label={t('roll', locale)}
          disabled={!ready || dirty}
          onClick={() => run({ type: 'roll' })}
        >
          <DieFace locale={locale} value={3} size={24} /> {t('roll', locale)}
        </button>
      </div>
    </section>
  );
}

/* ---------- 购点 ---------- */

export function PointBuyPanel({ view, locale, run }: PanelProps) {
  const pb = view.pointBuy!;
  const keys = Object.keys(pb.costs)
    .map(Number)
    .sort((a, b) => a - b);
  const min = keys[0]!;
  const max = keys[keys.length - 1]!;
  const pct = Math.max(0, Math.min(100, (pb.spent / pb.budget) * 100));

  return (
    <section className="panel">
      <p className="panel-hint">{t('pointBuyHint', locale)}</p>
      {view.attempt.pointGeneration && (
        <p className="mono">
          2d6: {view.attempt.pointGeneration.rolls.join(' + ')} · {t('budget', locale)} {pb.budget}{' '}
          · {t('scoreCap', locale)} {view.attempt.pointGeneration.maximum}
        </p>
      )}
      <div
        className="budget-meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={pb.budget}
        aria-valuenow={pb.spent}
      >
        <div
          className={`budget-fill${pb.remaining < 0 ? ' over' : ''}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="budget-text mono">
        {t('spent', locale)} {pb.spent} / {pb.budget} · {t('remaining', locale)}{' '}
        <span className={pb.remaining < 0 ? 'bad' : pb.remaining > 0 ? 'warn' : 'ok'}>
          {pb.remaining}
        </span>
      </p>
      <div className="buy-grid">
        {view.version.order.map((ab) => {
          const score = view.attempt.scores[ab] ?? view.method.base;
          return (
            <div key={ab} className="buy-row">
              <AbilityName versionId={view.version.id} ability={ab} locale={locale} />
              <div className="stepper">
                <button
                  type="button"
                  className="btn btn-step"
                  disabled={score <= min}
                  onClick={() => run({ type: 'setScore', ability: ab, score: score - 1 })}
                  aria-label={`${ab} -1`}
                >
                  −
                </button>
                <span className="mono stepper-value">{score}</span>
                <button
                  type="button"
                  className="btn btn-step"
                  disabled={score >= max}
                  onClick={() => run({ type: 'setScore', ability: ab, score: score + 1 })}
                  aria-label={`${ab} +1`}
                >
                  +
                </button>
              </div>
              <span className="mono buy-cost">
                {t('cost', locale)} {pb.costs[String(score)]}
              </span>
            </div>
          );
        })}
      </div>
      <details className="cost-table">
        <summary>{t('costTable', locale)}</summary>
        <table>
          <thead>
            <tr>
              <th>{t('score', locale)}</th>
              {keys.map((k) => (
                <th key={k} className="mono">
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{t('cost', locale)}</td>
              {keys.map((k) => (
                <td key={k} className="mono">
                  {pb.costs[String(k)]}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </details>
    </section>
  );
}
