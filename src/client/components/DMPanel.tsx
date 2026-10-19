import { memo, useState } from 'react';
import { PasswordSettings } from './PasswordSettings';
import type { Room } from '../../shared/model';
import type { SmalltableClient } from '../controller';
export const DMPanel = memo(function DMPanel({
  maxNames,
  mapBytes,
  mapPixels,
  mapEdge,
  grid,
  names,
  dm,
  actions,
  connected,
}: {
  grid: Room['grid'];
  names: string[];
  maxNames?: number;
  mapBytes?: number;
  mapPixels?: number;
  mapEdge?: number;
  dm: boolean;
  actions: SmalltableClient;
  connected: boolean;
}) {
  const [password, setPassword] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false);
  async function task(fn: () => Promise<unknown>, success: string) {
    setBusy(true);
    setMessage('处理中…');
    try {
      await fn();
      setMessage(success);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel dm">
      <h2>
        DM 工具箱 <span className="badge">{dm ? '已解锁' : '已锁定'}</span>
      </h2>
      {!dm ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            actions.send({ type: 'unlock', password });
            setPassword('');
          }}
        >
          <label>
            DM 密码
            <input
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button disabled={!connected}>解锁工具箱</button>
        </form>
      ) : (
        <>
          <div className="button-row">
            <button onClick={() => actions.send({ type: 'lock' })}>锁定工具箱</button>
            <label className="button">
              替换地图
              <input
                type="file"
                hidden
                disabled={busy || !connected || mapBytes === undefined}
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && mapBytes !== undefined && f.size > mapBytes)
                    setMessage(`地图文件超过 ${mapBytes} 字节`);
                  else if (f && confirm('替换地图？现有棋子将保留原坐标。'))
                    void task(() => actions.upload(f, 'map'), '地图已替换');
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <p className="meta">
            地图：{mapBytes ?? '—'} 字节 · {mapPixels ?? '—'} 像素 · 单边 {mapEdge ?? '—'} 像素
          </p>
          <GridEditor
            key={`${grid.cell}:${grid.x}:${grid.y}:${grid.visible}`}
            initialGrid={grid}
            actions={actions}
          />
          <NamesEditor
            maxNames={maxNames}
            key={JSON.stringify(names)}
            names={names}
            actions={actions}
          />
          <PasswordSettings actions={actions} connected={connected} />
          <h3>房间存档</h3>
          <div className="button-row">
            <button
              disabled={busy || !connected}
              onClick={() => void task(() => actions.backup(), '备份已下载')}
            >
              导出完整备份
            </button>
            <label className="button">
              恢复备份
              <input
                type="file"
                hidden
                accept=".zip,application/zip"
                disabled={busy || !connected}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f && confirm('恢复备份将覆盖当前桌面，私人笔记不受影响。继续？'))
                    void task(() => actions.restore(f), '房间已恢复');
                  e.target.value = '';
                }}
              />
            </label>
          </div>
          <button
            className="danger"
            disabled={!connected}
            onClick={() => {
              if (confirm('清空全部棋子？不提供撤销。')) actions.send({ type: 'clear' });
            }}
          >
            清空全部棋子
          </button>
        </>
      )}
      {message && (
        <p className="hint" role="status">
          {message}
        </p>
      )}
    </section>
  );
});
function GridEditor({
  initialGrid,
  actions,
}: {
  initialGrid: Room['grid'];
  actions: SmalltableClient;
}) {
  const [grid, setGrid] = useState(initialGrid);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        actions.send({ type: 'grid', grid });
      }}
    >
      <h3>方格标尺</h3>
      <label>
        每格地图像素
        <input
          type="number"
          min={4}
          max={2048}
          step="any"
          value={grid.cell}
          onChange={(e) => setGrid({ ...grid, cell: Number(e.target.value) })}
        />
      </label>
      <div className="two-col">
        {(['x', 'y'] as const).map((k) => (
          <label key={k}>
            偏移 {k.toUpperCase()}
            <input
              type="number"
              step="any"
              value={grid[k]}
              onChange={(e) => setGrid({ ...grid, [k]: Number(e.target.value) })}
            />
          </label>
        ))}
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={grid.visible}
          onChange={(e) => setGrid({ ...grid, visible: e.target.checked })}
        />
        显示网格线
      </label>
      <button>应用标尺</button>
    </form>
  );
}
function NamesEditor({
  names,
  actions,
  maxNames,
}: {
  names: string[];
  actions: SmalltableClient;
  maxNames?: number;
}) {
  const [text, setText] = useState(names.join('\n'));
  const values = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const valid = maxNames !== undefined && values.length > 0 && values.length <= maxNames;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) actions.send({ type: 'names', names: values });
      }}
    >
      <h3>骰子显示名称</h3>
      <label>
        每行一个名称
        <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} />
      </label>
      <span className="meta">
        {values.length} / {maxNames ?? '—'} 个名称
      </span>
      <button disabled={!valid}>保存名单</button>
    </form>
  );
}
