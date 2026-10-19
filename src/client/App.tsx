import { LoginPage } from './components/LoginPage';
import { useCallback, useState } from 'react';
import { useSmalltable } from './useSmalltable';
import { Board } from './components/Board';
import { Notes } from './components/Notes';
import { DicePanel } from './components/DicePanel';
import { Inspector, TokenList } from './components/Inspector';
import { AbilityTool } from './components/AbilityTool';
import { InitiativePanel } from './components/InitiativePanel';
import type { Drawing } from '../shared/model';
import { DMPanel } from './components/DMPanel';
export default function App() {
  const state = useSmalltable(),
    { actions, room, dm, connection } = state;
  const [selected, setSelected] = useState<string | null>(null),
    [tool, setTool] = useState<'move' | 'measure' | 'draw'>('move'),
    [fit, setFit] = useState(0),
    [abilityOpen, setAbilityOpen] = useState(false),
    [initiativeOpen, setInitiativeOpen] = useState(false),
    [drawColor, setDrawColor] = useState<Drawing['color']>('#d33b32'),
    [panelOpen, setPanelOpen] = useState(true),
    [tab, setTab] = useState<'dice' | 'tokens' | 'notes' | 'dm'>('dice');
  const closeInitiative = useCallback(() => setInitiativeOpen(false), []);
  const closeAbility = useCallback(() => setAbilityOpen(false), []);
  const caps = state.caps;
  const connected = connection === 'connected';
  const token = room?.tokens.find((t) => t.id === selected);
  if (!room)
    return (
      <LoginPage
        maxNotesBytes={caps?.maxNotesBytes}
        connection={connection}
        error={state.error}
        notice={state.notice}
        onSubmit={(value) => {
          void actions.join(value);
        }}
        onEdit={actions.dismiss}
      />
    );
  function create() {
    if (!room) return;
    const id = crypto.randomUUID();
    actions.send({
      type: 'create',
      token: {
        id,
        name: '',
        label: String(room.tokens.length + 1),
        shape: 'circle',
        color: '#3872a4',
        x: room.grid.cell * 2,
        y: room.grid.cell * 2,
        size: 1,
        angle: 0,
        asset: null,
        note: '',
        secret: '',
      },
    });
    setSelected(id);
    setTab('tokens');
  }
  return (
    <div className={`app ${panelOpen ? '' : 'panel-collapsed'}`}>
      <header>
        <div className="brand">
          SMALLTABLE <span>共享桌面</span>
        </div>
        <div className="status">
          <span className={`dot ${connected ? 'online' : ''}`} />
          {
            {
              connected: '已连接',
              connecting: '连接中',
              reconnecting: '重连中',
              disconnected: '未连接',
            }[connection]
          }
          <span>
            {state.count} / {state.max} 席
          </span>
          {room && <span>{state.savedRevision >= room.revision ? '已保存' : '待保存'}</span>}
        </div>
        <div className="header-actions">
          {room && (
            <button aria-expanded={initiativeOpen} onClick={() => setInitiativeOpen((v) => !v)}>
              先攻盘
            </button>
          )}
          {room && <button onClick={() => setAbilityOpen(true)}>属性工具</button>}
          <button onClick={() => window.alert('角色卡管理尚未实装，敬请期待。')}>角色卡管理</button>
          {room && <button onClick={() => actions.leave()}>离开房间</button>}
        </div>
      </header>
      {(state.error || state.notice) && (
        <div className={`message ${state.error ? 'error' : ''}`} role="alert">
          <span>{state.error || state.notice}</span>
          <button onClick={actions.dismiss} aria-label="关闭提示">
            ×
          </button>
        </div>
      )}
      <>
        <nav className="toolbar" aria-label="桌面工具">
          <div className="button-row">
            <button className={tool === 'move' ? 'active' : ''} onClick={() => setTool('move')}>
              选择 / 移动
            </button>
            <button
              className={tool === 'measure' ? 'active' : ''}
              onClick={() => setTool('measure')}
            >
              丈量（格）
            </button>
            <button className={tool === 'draw' ? 'active' : ''} onClick={() => setTool('draw')}>
              直线画笔
            </button>
            {tool === 'draw' && (
              <select
                aria-label="画笔颜色"
                value={drawColor}
                onChange={(e) => setDrawColor(e.target.value as Drawing['color'])}
              >
                <option value="#d33b32">红色</option>
                <option value="#246fc2">蓝色</option>
                <option value="#2b8a50">绿色</option>
                <option value="#9a4bb5">紫色</option>
                <option value="#202b36">黑色</option>
              </select>
            )}
            {tool === 'draw' && (
              <span className="meta">
                线条 {room.drawings.length} / {caps?.maxDrawings ?? '—'}
              </span>
            )}
            {dm && tool === 'draw' && (
              <button
                disabled={!connected || !room.drawings.length}
                onClick={() => {
                  if (confirm('清空所有玩家的线条？')) actions.clearDrawings();
                }}
              >
                清空线条
              </button>
            )}
            <button onClick={() => setFit((f) => f + 1)}>查看全部</button>
          </div>
          <div className="button-row">
            <button
              className="mobile-panel-toggle"
              aria-expanded={panelOpen}
              onClick={() => setPanelOpen((v) => !v)}
            >
              {panelOpen ? '收起面板' : '展开面板'}
            </button>
            <span className="meta">
              棋子 {room.tokens.length} / {caps?.maxTokens ?? '—'}
            </span>
          </div>
        </nav>
        <main className="workspace">
          {initiativeOpen && (
            <InitiativePanel
              entries={room.initiative}
              ascending={room.initiativeAscending}
              maxEntries={caps?.maxInitiative}
              actions={actions}
              connected={connected}
              onClose={closeInitiative}
            />
          )}
          <Board
            room={room}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              if (id) setTab('tokens');
            }}
            actions={actions}
            tool={tool}
            drawColor={drawColor}
            fitSignal={fit}
            epoch={state.epoch}
            connected={connected}
            maxDrawings={caps?.maxDrawings}
          />
          <aside>
            <nav className="tabs" aria-label="侧面板">
              {(
                [
                  ['dice', '骰盘'],
                  ['tokens', '棋子'],
                  ['notes', '笔记'],
                  ['dm', 'DM 工具'],
                ] as const
              ).map(([id, label]) => (
                <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </nav>
            <div className="sidebar-content">
              <div hidden={tab !== 'dice'}>
                <DicePanel
                  maxRolls={caps?.maxRolls}
                  rolls={room.rolls}
                  names={room.names}
                  actions={actions}
                  connected={connected}
                />
              </div>
              <div hidden={tab !== 'tokens'}>
                {dm && (
                  <section className="panel">
                    <button
                      disabled={!connected || !caps || room.tokens.length >= caps.maxTokens}
                      onClick={create}
                    >
                      ＋ 无图片棋子
                    </button>
                  </section>
                )}
                <Inspector
                  token={token}
                  dm={dm}
                  actions={actions}
                  connected={connected}
                  tokenBytes={caps?.tokenBytes}
                  tokenEdge={caps?.tokenEdge}
                  maxTokens={caps?.maxTokens}
                />
                <TokenList
                  maxTokens={caps?.maxTokens}
                  tokens={room.tokens}
                  selected={selected}
                  onSelect={setSelected}
                />
              </div>
              <div hidden={tab !== 'notes'}>
                <Notes maxBytes={caps?.maxNotesBytes} />
              </div>
              <div hidden={tab !== 'dm'}>
                <DMPanel
                  mapBytes={caps?.mapBytes}
                  mapPixels={caps?.mapPixels}
                  mapEdge={caps?.mapEdge}
                  maxNames={caps?.maxNames}
                  grid={room.grid}
                  names={room.names}
                  dm={dm}
                  actions={actions}
                  connected={connected}
                />
              </div>
            </div>
          </aside>
        </main>
        <AbilityTool open={abilityOpen} onClose={closeAbility} actions={actions} />
        <footer>
          格是标尺，规则由人解释。
          <span>{dm ? 'DM 工具箱已解锁' : '普通桌面权限'} · 不提供撤销</span>
        </footer>
      </>
    </div>
  );
}
