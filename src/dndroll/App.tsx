import { getAbilityDisplay } from '@dndroll/core';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  RULES_VERSION,
  getMethod,
  isRandomMethod,
  formatAbilityScore,
  listMethods,
  listVersions,
  type CreateRequest,
  type Locale,
  type Method,
  type Rng,
  type SessionOptions,
  type VersionId,
} from '@dndroll/core';
import { ExceptionalPanel } from './components/ExceptionalPanel';
import { getHistoryView } from './historyView';
import { HistoryPreview } from './components/HistoryPreview';
import { getAbilityName, t } from './i18n';
import { loadPrefs, savePrefs, useSessionController } from './store';
import { AbilityModifier, ConfirmDialog, Issues, Notices, PhaseSteps } from './components/common';
import {
  AllocatePanel,
  AssignPanel,
  PairsPanel,
  PointBuyPanel,
  PoolPanel,
  RollPanel,
  SetsPanel,
} from './components/panels';
import { ClassPanel, FinalizeBar, RerollBar } from './components/classTrade';
import { CompletePanel, ExportSaveButton, ImportModal } from './components/exporting';

interface Selection {
  versionId: VersionId;
  methodId: string | null;
}

export default function App({ rng }: { rng?: Rng }) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const locale: Locale = prefs.locale;
  const ctl = useSessionController(rng);
  const versions = useMemo(listVersions, []);
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);
  useEffect(() => {
    document.documentElement.dataset.theme = prefs.theme ?? 'light';
  }, [prefs.theme]);

  const [sel, setSel] = useState<Selection>(() => ({
    versionId: ctl.session?.request.versionId ?? versions[0]!.id,
    methodId: ctl.session?.request.methodId ?? null,
  }));
  const [opts, setOpts] = useState<SessionOptions>({});
  const [confirm, setConfirm] = useState<{ action: () => void } | null>(null);
  const [showImport, setShowImport] = useState(false);

  const { session, view } = ctl;
  const methods = useMemo(() => listMethods(sel.versionId), [sel.versionId]);
  const selectedMethod: Method | null = useMemo(() => {
    if (!sel.methodId) return null;
    try {
      return getMethod(sel.methodId);
    } catch {
      return null;
    }
  }, [sel.methodId]);

  // 切换方法时重置选项默认值
  useEffect(() => {
    if (!selectedMethod) {
      setOpts({});
      return;
    }
    const next: SessionOptions = {};
    if (selectedMethod.mode === 'buy') {
      const remembered = selectedMethod.id === 'pf1.purchase' ? prefs.pf1Budget : undefined;
      next.budget =
        remembered && selectedMethod.budgets.includes(remembered)
          ? remembered
          : (selectedMethod.defaultBudget ?? selectedMethod.budgets[0]);
    }
    if (selectedMethod.canChooseOrder) next.inOrder = false;
    if (selectedMethod.mode === 'pool') next.poolTotal = selectedMethod.poolTotals[0];
    setOpts(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMethod?.id]);

  const browsing =
    !!session &&
    (sel.versionId !== session.request.versionId || sel.methodId !== session.request.methodId);

  const hasProgress = !!session && session.events.length > 0;
  const guarded = (action: () => void) => {
    if (hasProgress) setConfirm({ action });
    else action();
  };

  const selectMethod = (versionId: VersionId, methodId: string) => {
    setSel({ versionId, methodId });
  };

  const selectedRequest = useMemo<CreateRequest | null>(() => {
    if (!selectedMethod || selectedMethod.status !== 'ready') return null;
    const options: SessionOptions = {};
    if (selectedMethod.mode === 'buy' && opts.budget !== undefined) options.budget = opts.budget;
    if (selectedMethod.canChooseOrder) options.inOrder = opts.inOrder ?? false;
    if (selectedMethod.mode === 'pool' && opts.poolTotal !== undefined)
      options.poolTotal = opts.poolTotal;
    return { versionId: selectedMethod.versionId, methodId: selectedMethod.id, options };
  }, [selectedMethod, opts]);

  const startSession = () => {
    if (!selectedRequest) return;
    const options = selectedRequest.options ?? {};
    guarded(() => {
      if (ctl.start(selectedRequest)) {
        if (selectedRequest.methodId === 'pf1.purchase' && options.budget !== undefined) {
          const next = { ...prefs, pf1Budget: options.budget };
          setPrefs(next);
          savePrefs(next);
        }
      }
    });
  };

  const newSession = () =>
    guarded(() => {
      ctl.endSession();
    });

  const toggleLocale = () => {
    const next = { ...prefs, locale: locale === 'zh' ? ('en' as const) : ('zh' as const) };
    setPrefs(next);
    savePrefs(next);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ⚄
          </span>
          <div className="brand-text">
            <h1>{t('appTitle', locale)}</h1>
            <p>{t('appSubtitle', locale)}</p>
          </div>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="btn"
            onClick={() => {
              const next = {
                ...prefs,
                theme: prefs.theme === 'light' ? ('dark' as const) : ('light' as const),
              };
              setPrefs(next);
              savePrefs(next);
            }}
          >
            {t(prefs.theme === 'light' ? 'darkTheme' : 'lightTheme', locale)}
          </button>
          <button type="button" className="btn" onClick={() => setShowImport(true)}>
            {t('importJson', locale)}
          </button>
          <button type="button" className="btn" onClick={toggleLocale}>
            {t('language', locale)}
          </button>
        </div>
      </header>

      {ctl.corruptError && (
        <div className="banner banner-error" role="alert">
          <span>
            {t('savedCorrupt', locale)} ({ctl.corruptError.code}:{' '}
            {ctl.corruptError.messages[locale]})
          </span>
          <button type="button" className="btn btn-danger" onClick={ctl.dismissCorrupt}>
            {t('clearSaved', locale)}
          </button>
        </div>
      )}
      {ctl.resumedFromSave && session && (
        <div className="banner banner-info" role="status">
          <span>{t('savedBanner', locale)}</span>
          <button type="button" className="btn btn-ghost" onClick={ctl.dismissResumed}>
            ✕
          </button>
        </div>
      )}

      <div className="shell">
        <nav className="rail" aria-label={t('versions', locale)}>
          <h2 className="rail-head">{t('versions', locale)}</h2>
          <ul className="rail-list">
            {versions.map((v) => (
              <li key={v.id}>
                <button
                  type="button"
                  className={`rail-item${sel.versionId === v.id ? ' active' : ''}`}
                  onClick={() =>
                    setSel({
                      versionId: v.id,
                      methodId:
                        session && session.request.versionId === v.id
                          ? session.request.methodId
                          : null,
                    })
                  }
                >
                  {v.name[locale]}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <aside className="method-col" aria-label={t('methods', locale)}>
          <h2 className="rail-head">{t('methods', locale)}</h2>
          <ul className="method-list">
            {methods.map((m) => {
              const pending = m.status !== 'ready';
              const active = sel.methodId === m.id;
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`method-card${active ? ' active' : ''}${pending ? ' pending' : ''}`}
                    disabled={pending}
                    onClick={() => selectMethod(sel.versionId, m.id)}
                  >
                    <span className="method-head">
                      <span className="method-name">{m.name[locale]}</span>
                      <span
                        className={`badge ${pending ? 'badge-dim' : m.category === 'standard' ? 'badge-std' : 'badge-opt'}`}
                      >
                        {pending
                          ? t('pending', locale)
                          : m.category === 'standard'
                            ? t('standard', locale)
                            : t('officialOption', locale)}
                      </span>
                    </span>
                    <span className="method-desc">{m.description[locale]}</span>
                    {pending && (
                      <span className="method-pending-note">{t('pendingNote', locale)}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        <main className="workspace">
          {browsing && (
            <div className="banner banner-info" role="status">
              <span>{t('browsingNotice', locale)}</span>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  setSel({
                    versionId: session.request.versionId,
                    methodId: session.request.methodId,
                  })
                }
              >
                {t('backToSession', locale)}
              </button>
            </div>
          )}
          {!session && !selectedMethod && (
            <div className="empty">
              <p className="empty-title">{t('chooseMethod', locale)}</p>
              <p>{t('chooseMethodHint', locale)}</p>
              <p className="empty-foot">{t('emptyWorkspace', locale)}</p>
            </div>
          )}

          {(!session || browsing) && selectedMethod && selectedMethod.status === 'ready' && (
            <section className="panel config-panel">
              <h2 className="workspace-title">
                {versions.find((v) => v.id === selectedMethod.versionId)?.name[locale]} ·{' '}
                {selectedMethod.name[locale]}
              </h2>
              <p className="method-full-desc">{selectedMethod.description[locale]}</p>
              {selectedMethod.notes.length > 0 && (
                <ul className="method-notes">
                  {selectedMethod.notes.map((n, i) => (
                    <li key={i}>{n[locale]}</li>
                  ))}
                </ul>
              )}
              <p className="final-source mono">
                {t('source', locale)}: {selectedMethod.source.title},{' '}
                {selectedMethod.source.location}
              </p>

              {(selectedMethod.budgets.length > 0 ||
                selectedMethod.canChooseOrder ||
                selectedMethod.poolTotals.length > 0) && (
                <fieldset className="options">
                  <legend>{t('methodOptions', locale)}</legend>
                  {selectedMethod.budgets.length > 0 && (
                    <div className="option-row" role="radiogroup" aria-label={t('budget', locale)}>
                      <span className="option-label">{t('budget', locale)}</span>
                      {selectedMethod.budgets.map((b) => (
                        <button
                          key={b}
                          type="button"
                          role="radio"
                          aria-checked={opts.budget === b}
                          className={`chip${opts.budget === b ? ' chosen' : ''}`}
                          onClick={() => setOpts({ ...opts, budget: b })}
                        >
                          {b}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedMethod.poolTotals.length > 0 && (
                    <div
                      className="option-row"
                      role="radiogroup"
                      aria-label={t('poolTotal', locale)}
                    >
                      <span className="option-label">{t('poolTotal', locale)}</span>
                      {selectedMethod.poolTotals.map((p) => (
                        <button
                          key={p}
                          type="button"
                          role="radio"
                          aria-checked={opts.poolTotal === p}
                          className={`chip${opts.poolTotal === p ? ' chosen' : ''}`}
                          onClick={() => setOpts({ ...opts, poolTotal: p })}
                        >
                          {p}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedMethod.canChooseOrder && (
                    <div className="option-row">
                      <span className="option-label">{t('freeAssign', locale)} / 3d6</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={!!opts.inOrder}
                        className={`chip${opts.inOrder ? ' chosen' : ''}`}
                        onClick={() => setOpts({ ...opts, inOrder: !opts.inOrder })}
                      >
                        {t('inOrder', locale)}
                      </button>
                    </div>
                  )}
                  <p className="panel-hint">{t('optionNote', locale)}</p>
                </fieldset>
              )}

              <button type="button" className="btn btn-primary btn-start" onClick={startSession}>
                {t('start', locale)}
              </button>
            </section>
          )}

          {session && view && (
            <Fragment key={ctl.workspaceKey}>
              <div className="workspace-head">
                <h2 className="workspace-title">
                  {view.version.name[locale]} · {view.method.name[locale]}
                </h2>
                <div className="workspace-actions">
                  <ExportSaveButton session={session} locale={locale} />
                  <button type="button" className="btn" onClick={newSession}>
                    {t('newSession', locale)}
                  </button>
                </div>
              </div>
              <p className="method-full-desc">{view.method.description[locale]}</p>
              <PhaseSteps view={view} locale={locale} />
              <Notices notices={view.notices} locale={locale} />
              <Issues issues={view.issues} locale={locale} />
              {ctl.actionError && (
                <p className="issue issue-error" role="alert">
                  {t('errorPrefix', locale)} · {ctl.actionError.code}:{' '}
                  {ctl.actionError.messages[locale]}
                </p>
              )}

              {view.attempt.generated && isRandomMethod(view.method) && (
                <div className="quick-roll-bar" role="region" aria-label={t('quickRoll', locale)}>
                  <span className="panel-hint">{t('quickRollHint', locale)}</span>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      if (ctl.nextGroup())
                        setSel({
                          versionId: session.request.versionId,
                          methodId: session.request.methodId,
                        });
                    }}
                  >
                    {t('nextGroup', locale)}
                  </button>
                </div>
              )}

              {view.phase !== 'complete' && (
                <>
                  {!view.attempt.generated && view.method.mode === 'pool' && (
                    <PoolPanel view={view} locale={locale} run={ctl.run} />
                  )}
                  {!view.attempt.generated &&
                    view.allowedActions.includes('roll') &&
                    view.method.mode !== 'pool' && (
                      <RollPanel view={view} locale={locale} run={ctl.run} />
                    )}
                  {view.attempt.generated && view.allowedActions.includes('assign') && (
                    <AssignPanel view={view} locale={locale} run={ctl.run} />
                  )}
                  {view.attempt.generated && view.allowedActions.includes('choosePair') && (
                    <PairsPanel view={view} locale={locale} run={ctl.run} />
                  )}
                  {view.attempt.generated && view.allowedActions.includes('chooseSet') && (
                    <SetsPanel view={view} locale={locale} run={ctl.run} />
                  )}
                  {view.attempt.generated && view.allowedActions.includes('allocateDie') && (
                    <AllocatePanel view={view} locale={locale} run={ctl.run} />
                  )}
                  {view.attempt.generated && view.allowedActions.includes('setScore') && (
                    <PointBuyPanel view={view} locale={locale} run={ctl.run} />
                  )}
                  {view.attempt.generated && view.classOptions.length > 0 && (
                    <ClassPanel view={view} locale={locale} run={ctl.run} />
                  )}
                  {view.attempt.generated && (
                    <ExceptionalPanel view={view} locale={locale} run={ctl.run} />
                  )}
                  {view.attempt.generated && <ScoreStrip view={view} locale={locale} />}
                  <RerollBar view={view} locale={locale} run={ctl.run} />
                  <FinalizeBar view={view} locale={locale} run={ctl.run} />
                </>
              )}

              {view.phase === 'complete' && (
                <CompletePanel session={session} view={view} locale={locale} onNew={newSession} />
              )}
            </Fragment>
          )}
          {ctl.history.length > 0 && (
            <section className="panel roll-history" aria-label={t('recentGroups', locale)}>
              <h2>
                {t('recentGroups', locale)} ({ctl.history.length}/10)
              </h2>
              <p className="panel-hint">{t('historyHint', locale)}</p>
              <div className="history-list">
                {[...ctl.history].reverse().map((entry) => {
                  const hv = getHistoryView(entry.session);
                  return (
                    <div className="history-entry" key={entry.id}>
                      <button
                        type="button"
                        className={`btn${ctl.activeHistoryId === entry.id ? ' btn-primary' : ''}`}
                        aria-pressed={ctl.activeHistoryId === entry.id}
                        onClick={() => {
                          ctl.restoreGroup(entry.id);
                          setSel({
                            versionId: entry.session.request.versionId,
                            methodId: entry.session.request.methodId,
                          });
                        }}
                      >
                        {t('historyGroup', locale, { n: entry.id })} · {hv.version.name[locale]} ·{' '}
                        {hv.method.name[locale]}
                      </button>
                      <HistoryPreview view={hv} locale={locale} />
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {session && !view && (
            <p className="issue issue-error" role="alert">
              {t('importFail', locale)}
            </p>
          )}
        </main>
      </div>

      <footer className="footer">
        <span>{t('offlineNote', locale)}</span>
        <span className="mono">
          {t('rulesVersion', locale)} {RULES_VERSION}
        </span>
      </footer>

      {confirm && (
        <ConfirmDialog
          title={t('abandonTitle', locale)}
          body={t('abandonBody', locale)}
          confirmLabel={t('confirm', locale)}
          locale={locale}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const a = confirm.action;
            setConfirm(null);
            a();
          }}
        />
      )}
      {showImport && (
        <ImportModal
          locale={locale}
          onClose={() => setShowImport(false)}
          onRestore={(s) =>
            guarded(() => {
              ctl.replaceSession(s);
              setSel({ versionId: s.request.versionId, methodId: s.request.methodId });
            })
          }
        />
      )}
    </div>
  );
}

/** 进行中的当前数值速览。 */
function ScoreStrip({
  view,
  locale,
}: {
  view: import('@dndroll/core').SessionView;
  locale: Locale;
}) {
  const { scores, baseScores } = view.attempt;
  const hasAny = Object.keys(scores).length > 0;
  if (!hasAny) return null;
  return (
    <section className="panel score-strip" aria-label={t('score', locale)}>
      {view.version.order.map((ab) => {
        const s = scores[ab];
        const b = baseScores[ab];
        return (
          <div key={ab} className="strip-cell">
            <span className="ability-abbr">{getAbilityDisplay(view.version.id, ab).id}</span>
            <span className="ability-full">{getAbilityName(view.version.id, ab, locale)}</span>
            <span className="mono strip-score">
              {formatAbilityScore(ab, s, view.attempt.exceptionalStrength)}
            </span>
            <AbilityModifier versionId={view.version.id} score={s} locale={locale} />
            {b !== undefined && s !== undefined && b !== s && (
              <span className="mono strip-base">({b})</span>
            )}
          </div>
        );
      })}
    </section>
  );
}
