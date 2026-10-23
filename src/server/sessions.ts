import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocket } from 'ws';
import type { Capabilities } from '../shared/limits.js';
import { SessionError, SESSION_CLOSE } from '../shared/session.js';
import { Limiter } from './auth.js';
export interface Session {
  id: string;
  name: string;
  source: 'room' | 'dm';
  dm: boolean;
  reservedUntil: number;
  ws?: WebSocket;
  target?: string;
  order: number;
  alive: boolean;
  limiter: Limiter;
  rollLimiter: Limiter;
  moveAt: Map<string, number>;
  disconnectedUntil?: number;
  missed: number;
}
export class Sessions extends Map<string, Session> {
  private order = 0;
  constructor(
    private caps: Capabilities,
    private changed: () => void,
    readonly now = Date.now,
  ) {
    super();
  }
  online(s: Session) {
    return s.ws?.readyState === WebSocket.OPEN;
  }
  revoke(s: Session, code: keyof typeof SESSION_CLOSE, message: string) {
    this.delete(s.id);
    const ws = s.ws;
    s.ws = undefined;
    s.reservedUntil = 0;
    s.target = undefined;
    ws?.close(SESSION_CLOSE[code], message);
    this.changed();
  }
  valid(s: Session | undefined): s is Session {
    if (!s || this.get(s.id) !== s) return false;
    if (!this.online(s) && s.disconnectedUntil !== undefined && this.now() >= s.disconnectedUntil) {
      this.revoke(s, 'EXPIRED', '会话恢复期限已过，请重新进入');
      return false;
    }
    return true;
  }
  occupied(s: Session) {
    return this.online(s) || s.reservedUntil > this.now();
  }
  check(name: string, dm: boolean, except?: Session) {
    for (const s of [...this.values()]) this.valid(s);
    const others = [...this.values()].filter((s) => s !== except && this.occupied(s));
    if (others.some((s) => s.name.toLowerCase() === name.toLowerCase()))
      throw new SessionError('ID_CONFLICT', '原临时 ID 已被使用，请更换 ID 并重新登录');
    if (others.filter((s) => s.dm === dm).length >= (dm ? this.caps.maxDMs : this.caps.maxSeats))
      throw new SessionError(dm ? 'DM_FULL' : 'PLAYER_FULL', dm ? 'DM 席位已满' : '房间人数已满');
  }
  create(name: string, dm: boolean) {
    const s: Session = {
      id: randomBytes(32).toString('hex'),
      name,
      dm,
      source: dm ? 'dm' : 'room',
      reservedUntil: this.now() + 15000,
      order: 0,
      alive: true,
      limiter: new Limiter(50, 25),
      rollLimiter: new Limiter(4, 1),
      moveAt: new Map(),
      missed: 0,
      disconnectedUntil: this.now() + 45 * 60000,
    };
    this.set(s.id, s);
    return s;
  }
  reserve(s: Session) {
    if (!this.valid(s)) throw new SessionError('EXPIRED', '请重新输入房间密码', 401);
    this.check(s.name, s.dm, s);
    s.reservedUntil = this.now() + 15000;
  }
  attach(s: Session, ws: WebSocket) {
    const previous = s.ws;
    s.ws = ws;
    s.target = randomUUID();
    s.order = ++this.order;
    s.reservedUntil = 0;
    s.alive = true;
    s.missed = 0;
    s.disconnectedUntil = undefined;
    s.moveAt.clear();
    previous?.close(SESSION_CLOSE.REPLACED, '此会话已在其他页面打开');
  }
  detach(s: Session, ws: WebSocket) {
    if (s.ws !== ws) return;
    s.ws = undefined;
    s.target = undefined;
    s.reservedUntil = 0;
    s.disconnectedUntil = this.now() + 45 * 60000;
    this.changed();
  }
  heartbeat(s: Session) {
    if (!s.ws) return;
    if (!s.alive && ++s.missed >= 3) {
      const ws = s.ws;
      this.detach(s, ws);
      ws.terminate();
      return;
    }
    s.alive = false;
    s.ws.ping();
  }
  role(s: Session, dm: boolean) {
    if (s.dm === dm) return;
    this.check(s.name, dm, s);
    s.dm = dm;
    s.target = this.online(s) ? randomUUID() : undefined;
    this.changed();
  }
  demote(s: Session) {
    if (!s.dm) return;
    if (!this.occupied(s)) {
      s.dm = false;
      s.target = undefined;
      return;
    }
    try {
      this.role(s, false);
    } catch {
      this.revoke(s, 'DEMOTION_FULL', '普通席位已满，已退出房间');
    }
  }
}
