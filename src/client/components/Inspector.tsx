import { memo, useEffect, useState } from 'react';
import type { PublicToken, Token } from '../../shared/model';
import type { SmalltableClient } from '../controller';
export function Inspector({
  token,
  dm,
  actions,
  connected,
  tokenBytes,
  tokenEdge,
  maxTokens,
}: {
  token: PublicToken | undefined;
  dm: boolean;
  actions: SmalltableClient;
  connected: boolean;
  tokenBytes?: number;
  tokenEdge?: number;
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
            <button disabled={!connected} onClick={() => actions.rotate(token, -90)}>
              ↶ 90°
            </button>
            <button disabled={!connected} onClick={() => actions.rotate(token, 90)}>
              ↷ 90°
            </button>
            <button disabled={!connected} onClick={() => actions.rotate(token, 15)}>
              ↷ 15°
            </button>
          </div>
          <PublicNoteEditor
            key={`note:${token.id}`}
            token={token}
            actions={actions}
            connected={connected}
          />
          {dm && (
            <TokenEditor
              key={`editor:${token.id}`}
              tokenBytes={tokenBytes}
              tokenEdge={tokenEdge}
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
  tokenEdge,
  maxTokens,
}: {
  token: PublicToken;
  actions: SmalltableClient;
  connected: boolean;
  tokenBytes?: number;
  tokenEdge?: number;
  maxTokens?: number;
}) {
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
      const image = await actions.upload(file, 'token');
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
      onSubmit={(e) => {
        e.preventDefault();
        const latest = actions.getSnapshot().room?.tokens.find((t) => t.id === token.id);
        if (!latest) return;
        actions.send({
          type: 'edit',
          token: { ...draft, note: latest.note, x: latest.x, y: latest.y, angle: latest.angle },
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
      <p className="meta">
        棋子图片：{tokenBytes ?? '—'} 字节 · 单边 {tokenEdge ?? '—'} 像素
      </p>
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
        <button type="button" disabled={!connected} onClick={() => field('asset', null)}>
          使用无图片外观
        </button>
      </div>
      <div className="button-row">
        <button className="primary" disabled={!connected || busy}>
          保存修改
        </button>
        <button
          type="button"
          disabled={
            !connected ||
            maxTokens === undefined ||
            (actions.getSnapshot().room?.tokens.length ?? 0) >= maxTokens
          }
          onClick={() =>
            actions.send({
              type: 'create',
              token: {
                ...token,
                secret: token.secret ?? '',
                id: crypto.randomUUID(),
                x: token.x + 24,
                y: token.y + 24,
              },
            })
          }
        >
          复制
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
    maxTokens,
  }: {
    tokens: PublicToken[];
    selected: string | null;
    onSelect: (id: string) => void;
    maxTokens?: number;
  }) {
    return (
      <section className="panel">
        <h2>
          棋子清单{' '}
          <span className="meta">
            {tokens.length} / {maxTokens ?? '—'}
          </span>
        </h2>
        <div className="token-list">
          {tokens.map((t, i) => (
            <button
              key={t.id}
              className={selected === t.id ? 'active' : ''}
              onClick={() => onSelect(t.id)}
            >
              <span
                className="swatch"
                style={{ background: t.color, borderRadius: t.shape === 'circle' ? '50%' : 2 }}
              />
              {t.name || t.label || `棋子 ${i + 1}`}
            </button>
          ))}
          {!tokens.length && <p className="empty">桌面暂无棋子</p>}
        </div>
      </section>
    );
  },
  (a, b) =>
    a.selected === b.selected &&
    a.maxTokens === b.maxTokens &&
    a.onSelect === b.onSelect &&
    a.tokens.length === b.tokens.length &&
    a.tokens.every((t, i) => {
      const other = b.tokens[i];
      return (
        t.id === other.id &&
        t.name === other.name &&
        t.label === other.label &&
        t.color === other.color &&
        t.shape === other.shape
      );
    }),
);
