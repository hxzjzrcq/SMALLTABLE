import { useState } from 'react';
import { sortInitiative, type InitiativeEntry, type View } from '../../shared/model';
import type { SmalltableClient } from '../controller';

export function InitiativePanel({
  room,
  actions,
  connected,
  onClose,
}: {
  room: View;
  actions: SmalltableClient;
  connected: boolean;
  onClose: () => void;
}) {
  const [name, setName] = useState(''),
    [value, setValue] = useState('');
  return (
    <section className="initiative-panel panel" aria-label="先攻盘">
      <div className="initiative-heading">
        <h2>
          先攻盘 <span className="meta">{room.initiative.length}/255</span>
        </h2>
        <button onClick={onClose} aria-label="隐藏先攻盘">
          ×
        </button>
      </div>
      <button
        disabled={!connected}
        onClick={() => actions.orderInitiative(!room.initiativeAscending)}
      >
        {room.initiativeAscending ? '从小到大 ↑' : '从大到小 ↓'}
      </button>
      <form
        className="initiative-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !value.trim()) return;
          if (
            actions.putInitiative({
              id: crypto.randomUUID(),
              name: name.trim(),
              value: Number(value),
            })
          ) {
            setName('');
            setValue('');
          }
        }}
      >
        <input
          aria-label="先攻名字"
          placeholder="名字"
          required
          maxLength={128}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="先攻数字"
          placeholder="数字"
          required
          type="number"
          step="any"
          min={-1000000}
          max={1000000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button disabled={!connected || room.initiative.length >= 255}>添加</button>
      </form>
      <div className="initiative-list">
        {sortInitiative(room.initiative, room.initiativeAscending).map((entry) => (
          <InitiativeRow key={entry.id} entry={entry} actions={actions} connected={connected} />
        ))}
        {!room.initiative.length && <p className="empty">填写名字与数字，大家共同查看和编辑。</p>}
      </div>
    </section>
  );
}
function InitiativeRow({
  entry,
  actions,
  connected,
}: {
  entry: InitiativeEntry;
  actions: SmalltableClient;
  connected: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(entry.name),
    [value, setValue] = useState(String(entry.value));
  if (editing)
    return (
      <form
        className="initiative-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !value.trim()) return;
          if (actions.putInitiative({ id: entry.id, name: name.trim(), value: Number(value) }))
            setEditing(false);
        }}
      >
        <input
          aria-label="修改先攻名字"
          required
          maxLength={128}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          aria-label="修改先攻数字"
          required
          type="number"
          step="any"
          min={-1000000}
          max={1000000}
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
        <button disabled={!connected}>保存</button>
        <button type="button" onClick={() => setEditing(false)}>
          取消
        </button>
      </form>
    );
  return (
    <div className="initiative-row">
      <span className="initiative-name">{entry.name}</span>
      <strong>{entry.value}</strong>
      <button
        disabled={!connected}
        onClick={() => {
          setName(entry.name);
          setValue(String(entry.value));
          setEditing(true);
        }}
      >
        修改
      </button>
      <button
        disabled={!connected}
        aria-label={`删除先攻 ${entry.name}`}
        onClick={() => actions.deleteInitiative(entry.id)}
      >
        ×
      </button>
    </div>
  );
}
