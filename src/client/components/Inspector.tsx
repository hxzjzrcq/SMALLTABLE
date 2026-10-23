import { LabelEditor } from './PublicBox';
import { UploadStatus } from './UploadStatus';
import { memo, useEffect, useRef, useState } from 'react';
import { tokenLabel, type PublicToken, type Token } from '../../shared/model';
import type { SmalltableClient } from '../controller';
export function Inspector({
  token,
  dm,
  actions,
  connected,
  tokenBytes,
  maxTokens,
}: {
  token: PublicToken | undefined;
  dm: boolean;
  actions: SmalltableClient;
  connected: boolean;
  tokenBytes?: number;
  maxTokens?: number;
}) {
  return (
    <section className="panel inspector">
      <h2>选中棋子</h2>
      {!token ? (
        <p className="empty">在桌面或清单中选择一枚棋子</p>
      ) : (
        <>
          <strong>{token.name || token.label || '未命名棋子'}</strong>
          <div className="meta">
            边长 {token.size} 格 · 旋转 {Math.round(token.angle)}°
          </div>
          <div className="button-row">
            <button
              disabled={!connected || token.hidden}
              onClick={() => actions.rotate(token, -90)}
            >
              ↶ 90°
            </button>
            <button disabled={!connected || token.hidden} onClick={() => actions.rotate(token, 90)}>
              ↷ 90°
            </button>
            <button disabled={!connected || token.hidden} onClick={() => actions.rotate(token, 15)}>
              ↷ 15°
            </button>
          </div>
          {token.publicId && (
            <>
              <p>公共身份 {token.publicId}</p>
              <LabelEditor key={token.id} token={token} actions={actions} connected={connected} />
              <button
                disabled={!connected}
                onClick={() => {
                  if (confirm('归还这枚公共棋子并重置？'))
                    actions.send({ type: 'delete', id: token.id });
                }}
              >
                归还盒子
              </button>
            </>
          )}
          {!token.publicId && (
            <PublicNoteEditor
              key={`note:${token.id}`}
              token={token}
              actions={actions}
              connected={connected}
            />
          )}
          {dm && !token.publicId && (
            <TokenEditor
              key={`editor:${token.id}`}
              tokenBytes={tokenBytes}
              maxTokens={maxTokens}
              token={token}
              actions={actions}
              connected={connected}
            />
          )}
        </>
      )}
    </section>
  );
}
function PublicNoteEditor({
  token,
  actions,
  connected,
}: {
  token: PublicToken;
  actions: SmalltableClient;
  connected: boolean;
}) {
  const [note, setNote] = useState(token.note);
  const [dirty, setDirty] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // Incoming snapshots update clean fields without discarding an unfinished edit.
  useEffect(() => {
    if (!dirty) setNote(token.note);
    else if (token.note === note) setDirty(false);
  }, [token.note, dirty, note]);
  return (
    <form
      className="editor"
      onSubmit={(e) => {
        e.preventDefault();
        if (actions.editNote(token.id, note)) {
          setSubmitted(true);
        }
      }}
    >
      <label>
        公开注释（所有玩家可编辑）
        <textarea
          rows={3}
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setDirty(true);
            setSubmitted(false);
          }}
        />
      </label>
      <button disabled={!connected || !dirty}>保存公开注释</button>
      {submitted && (
        <p className="hint" role="status">
          已提交；请留意顶部保存状态
        </p>
      )}
    </form>
  );
}
function TokenEditor({
  token,
  actions,
  connected,
  tokenBytes,
  maxTokens,
}: {
  token: PublicToken;
  actions: SmalltableClient;
  connected: boolean;
  tokenBytes?: number;
  maxTokens?: number;
}) {
  const composing = useRef(false);
  const pendingUpload = useRef<string | undefined>(undefined);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      if (pendingUpload.current) void actions.cancelUpload(pendingUpload.current).catch(() => {});
    };
  }, [actions]);
  async function releaseUpload() {
    const id = pendingUpload.current;
    if (id) {
      await actions.cancelUpload(id);
      pendingUpload.current = undefined;
    }
  }
  const [draft, setDraft] = useState<Token>({ ...token, secret: token.secret ?? '' }),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const field = <K extends keyof Token>(key: K, value: Token[K]) =>
    setDraft((t) => ({ ...t, [key]: value }));
  async function upload(file?: File) {
    if (!file || tokenBytes === undefined) return;
    if (file.size > tokenBytes) {
      setError(`图片文件超过 ${tokenBytes} 字节`);
      return;
    }
    setBusy(true);
    try {
      await releaseUpload();
      const image = await actions.upload(file, 'token');
      if (!active.current) {
        if (image.uploadId) await actions.cancelUpload(image.uploadId);
        return;
      }
      pendingUpload.current = image.uploadId;
      field('asset', image.asset);
      setError('图片已准备，点击保存修改后生效');
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="editor"
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        if (composing.current) return;
        const latest = actions.getSnapshot().room?.tokens.find((t) => t.id === token.id);
        if (!latest) return;
        const label = tokenLabel.safeParse(draft.label);
        if (!label.success) {
          setError('棋面文字须为 1–4 个字符，不能含换行或控制字符');
          return;
        }
        actions.send({
          type: 'edit',
          uploadId: pendingUpload.current,
          token: {
            ...draft,
            label: label.data,
            note: latest.note,
            x: latest.x,
            y: latest.y,
            angle: latest.angle,
          },
        });
        setError('修改已提交；请留意顶部保存状态');
      }}
    >
      <label>
        名称
        <input value={draft.name} onChange={(e) => field('name', e.target.value)} />
      </label>
      <div className="two-col">
        <label>
          编号 / 短标记
          <input value={draft.label} onChange={(e) => field('label', e.target.value)} />
        </label>
        <label>
          颜色
          <input
            type="color"
            value={draft.color}
            onChange={(e) => field('color', e.target.value)}
          />
        </label>
      </div>
      <div className="two-col">
        <label>
          形状
          <select
            value={draft.shape}
            onChange={(e) => field('shape', e.target.value as Token['shape'])}
          >
            <option value="circle">圆形</option>
            <option value="square">方形</option>
          </select>
        </label>
        <label>
          占地边长（格）
          <input
            type="number"
            min={1 / 16}
            max={4}
            step="any"
            value={draft.size}
            onChange={(e) => field('size', Number(e.target.value))}
          />
        </label>
      </div>
      <label>
        DM 私有说明
        <textarea rows={3} value={draft.secret} onChange={(e) => field('secret', e.target.value)} />
      </label>
      <UploadStatus actions={actions} kind="token" />
      <div className="button-row">
        <label className="button">
          设置图片
          <input
            hidden
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={!connected || busy || tokenBytes === undefined}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <button
          type="button"
          disabled={!connected}
          onClick={() => {
            void releaseUpload()
              .then(() => field('asset', null))
              .catch((e) => setError(String(e)));
          }}
        >
          使用无图片外观
        </button>
      </div>
      <div className="button-row">
        <button
          type="button"
          disabled={busy || !connected}
          onClick={() => {
            void releaseUpload()
              .then(() => {
                setDraft({ ...token, secret: token.secret ?? '' });
                setError('编辑已取消');
              })
              .catch((e) => setError(String(e)));
          }}
        >
          取消编辑
        </button>
        <button className="primary" disabled={!connected || busy}>
          保存修改
        </button>
        <button
          type="button"
          disabled={
            !connected ||
            maxTokens === undefined ||
            (actions.getSnapshot().room?.tokens.filter((t) => !t.publicId).length ?? 0) >= maxTokens
          }
          onClick={() => actions.cloneToken(token.id)}
        >
          克隆
        </button>
        <button
          className="danger"
          type="button"
          disabled={!connected}
          onClick={() => {
            if (confirm('删除这枚棋子？')) actions.send({ type: 'delete', id: token.id });
          }}
        >
          删除
        </button>
      </div>
      {error && (
        <p role="status" className="hint">
          {error}
        </p>
      )}
    </form>
  );
}
export const TokenList = memo(
  function TokenList({
    tokens,
    selected,
    onSelect,
    onClone,
    connected = true,
    maxTokens,
    onLocate,
    onHidden,
    onReturn,
  }: {
    tokens: PublicToken[];
    selected: readonly string[];
    onSelect: (id: string, additive?: boolean) => void;
    onClone?: (id: string) => void;
    onLocate?: (id: string) => void;
    onHidden?: (id: string, hidden: boolean) => void;
    onReturn?: (id: string) => void;
    connected?: boolean;
    maxTokens?: number;
  }) {
    const selection = new Set(selected);
    return (
      <section className="panel">
        <h2>
          棋子清单{' '}
          <span className="meta">
            {tokens.filter((t) => !t.publicId).length} / {maxTokens ?? '—'}
          </span>
        </h2>
        <div className="token-list">
          {tokens.map((t, i) => (
            <div className="token-list-row" data-token-row-id={t.id} key={t.id}>
              <button
                data-board-selection="true"
                aria-pressed={selection.has(t.id)}
                className={selection.has(t.id) ? 'active' : ''}
                onClick={(e) => onSelect(t.id, e.shiftKey)}
                onDoubleClick={() => onLocate?.(t.id)}
              >
                <span
                  className="swatch"
                  style={{ background: t.color, borderRadius: t.shape === 'circle' ? '50%' : 2 }}
                />
                {t.publicId ? `${t.publicId} · ${t.label}` : t.name || t.label || `棋子 ${i + 1}`}{' '}
                {t.hidden ? ' · 已隐藏' : ''}
              </button>
              <details className="token-row-actions">
                <summary>操作</summary>
                {onLocate && <button onClick={() => onLocate(t.id)}>定位</button>}
                {onHidden && !t.publicId && (
                  <button disabled={!connected} onClick={() => onHidden(t.id, !t.hidden)}>
                    {t.hidden ? '显形' : '隐藏'}
                  </button>
                )}
                {t.publicId && onReturn && (
                  <button disabled={!connected} onClick={() => onReturn(t.id)}>
                    归还
                  </button>
                )}
                {onClone && (
                  <button
                    aria-label={`克隆 ${t.name || t.label || `棋子 ${i + 1}`}`}
                    disabled={
                      !connected ||
                      maxTokens === undefined ||
                      tokens.filter((t) => !t.publicId).length >= maxTokens
                    }
                    onClick={() => onClone(t.id)}
                  >
                    克隆
                  </button>
                )}
              </details>
            </div>
          ))}
          {!tokens.length && <p className="empty">桌面暂无棋子</p>}
        </div>
      </section>
    );
  },
  (a, b) =>
    a.onLocate === b.onLocate &&
    a.onHidden === b.onHidden &&
    a.onReturn === b.onReturn &&
    a.selected === b.selected &&
    a.onClone === b.onClone &&
    a.connected === b.connected &&
    a.maxTokens === b.maxTokens &&
    a.onSelect === b.onSelect &&
    a.tokens.length === b.tokens.length &&
    a.tokens.every((t, i) => {
      const other = b.tokens[i];
      return (
        t.id === other.id &&
        t.hidden === other.hidden &&
        t.publicId === other.publicId &&
        t.name === other.name &&
        t.label === other.label &&
        t.color === other.color &&
        t.shape === other.shape
      );
    }),
);
