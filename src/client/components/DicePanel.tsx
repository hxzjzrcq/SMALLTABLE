import { useState } from 'react';
import type { View } from '../../shared/model';
import type { SmalltableClient } from '../controller';
export function DicePanel({
  room,
  actions,
  connected,
}: {
  room: View;
  actions: SmalltableClient;
  connected: boolean;
}) {
  const [name, setName] = useState(''),
    [expression, setExpression] = useState('1d20');
  const current = room.names.includes(name) ? name : room.names[0];
  return (
    <section className="panel dice">
      <h2>
        公共骰盘 <span className="meta">最近 {room.rolls.length} / 255 条</span>
      </h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          actions.send({ type: 'roll', name: current, expression });
        }}
      >
        <label>
          显示名称
          <select value={current} onChange={(e) => setName(e.target.value)}>
            {room.names.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <div className="input-action">
          <input
            aria-label="骰子表达式"
            value={expression}
            maxLength={128}
            onChange={(e) => setExpression(e.target.value)}
            placeholder="1d20+5"
          />
          <button disabled={!connected} type="submit">
            投掷
          </button>
        </div>
      </form>
      <div className="quick-dice">
        {[4, 6, 8, 10, 12, 20, 100].map((n) => (
          <button
            key={n}
            disabled={!connected}
            onClick={() => {
              setExpression(`1d${n}`);
              actions.send({ type: 'roll', name: current, expression: `1d${n}` });
            }}
          >
            d{n}
          </button>
        ))}
      </div>
      <div className="roll-log" aria-live="polite">
        {[...room.rolls].reverse().map((r) => (
          <article className="roll" key={r.id}>
            <div>
              <strong>{r.name}</strong>
              <time>{new Date(r.time).toLocaleTimeString()}</time>
            </div>
            <div>
              <code>{r.expression}</code>
              <strong className="result">{r.result}</strong>
            </div>
            <small>
              {r.dice
                .map((d) => `${d.sign === -1 ? '−' : ''}d${d.sides} [${d.values.join(', ')}]`)
                .join('　')}
            </small>
          </article>
        ))}
        {!room.rolls.length && <p className="empty">还没有投骰记录</p>}
      </div>
    </section>
  );
}
