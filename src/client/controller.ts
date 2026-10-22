import type { MusicSnapshot } from '../shared/music';
import { coordinate, WORLD_LIMIT } from '../shared/model';
import type { PasswordChange } from '../shared/passwords';
import type { Capabilities, Command, ServerEvent, View, PublicToken } from '../shared/model';
export type Connection = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export interface ClientState {
  connection: Connection;
  room: View | null;
  dm: boolean;
  epoch: number;
  count: number;
  max: number;
  savedRevision: number;
  error: string;
  notice: string;
  caps: Capabilities | null;
  music?: MusicSnapshot;
  musicConsent?: { pushId: string };
}
const empty: ClientState = {
  connection: 'disconnected',
  room: null,
  dm: false,
  epoch: 0,
  count: 0,
  max: 0,
  savedRevision: -1,
  error: '',
  notice: '',
  caps: null,
};
/** UI-independent facade. Components consume state and commands, never sockets. */
export class SmalltableClient {
  private state: ClientState = { ...empty };
  private listeners = new Set<() => void>();
  private ws?: WebSocket;
  private token = '';
  private password = '';
  private generation = 0;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private lastActivity = 0;
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getSnapshot = () => this.state;
  private patch(p: Partial<ClientState>) {
    this.state = { ...this.state, ...p };
    for (const f of this.listeners) f();
  }
  dismiss = () => this.patch({ error: '', notice: '' });
  async loadConfig() {
    try {
      const caps = await this.request<Capabilities>('/api/config');
      this.patch({ caps, max: caps.maxSeats });
    } catch (e) {
      this.fail(e);
    }
  }
  private fail(e: unknown) {
    this.patch({ error: e instanceof Error ? e.message : String(e) });
  }
  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      },
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        message = (await res.json()).error ?? message;
      } catch {}
      throw Error(message);
    }
    return res.json();
  }
  async join(password: string) {
    this.leave();
    this.password = password;
    this.attempts = 0;
    await this.connect(false);
  }
  private async connect(retry: boolean) {
    const gen = ++this.generation;
    this.patch({ connection: retry ? 'reconnecting' : 'connecting', error: '', notice: '' });
    try {
      const data = await this.request<{ token: string }>('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: this.password }),
      });
      if (gen !== this.generation) return;
      this.token = data.token;
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
        ['tabletop', this.token],
      );
      this.ws = ws;
      ws.onmessage = (event) => {
        if (gen !== this.generation) return;
        try {
          this.receive(JSON.parse(event.data));
        } catch {
          this.patch({ error: '服务器消息格式异常，请重新进入' });
        }
      };
      ws.onopen = () => {
        if (gen !== this.generation) return;
        this.attempts = 0;
        this.patch({ connection: 'connected' });
        this.activity(true);
      };
      ws.onerror = () => {};
      ws.onclose = (event) => {
        if (gen !== this.generation) return;
        this.token = '';
        this.patch({
          connection: 'disconnected',
          dm: false,
          room: this.state.room
            ? {
                ...this.state.room,
                tokens: this.state.room.tokens.map(({ secret, ...token }) => token),
              }
            : null,
          notice: event.code === 4001 ? '长时间无操作，已离开房间' : event.reason || '连接断开',
        });
        if (event.code === 4003) {
          this.password = '';
          clearTimeout(this.reconnectTimer);
          this.patch({ room: null, music: undefined, count: 0, savedRevision: -1 });
        }
        if (event.code !== 4001 && event.code !== 4003 && this.password && this.attempts++ < 3)
          this.reconnectTimer = setTimeout(
            () => void this.connect(true),
            Math.min(8000, 1000 * 2 ** this.attempts),
          );
      };
    } catch (e) {
      this.fail(e);
      this.patch({ connection: 'disconnected' });
    }
  }
  leave = () => {
    this.generation++;
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = undefined;
    this.token = '';
    this.password = '';
    this.patch({
      connection: 'disconnected',
      dm: false,
      room: null,
      music: undefined,
      count: 0,
      savedRevision: -1,
    });
  };
  private receive(event: ServerEvent) {
    switch (event.type) {
      case 'snapshot':
        this.patch({
          room: event.room,
          dm: event.dm,
          epoch: event.epoch,
          caps: event.caps ?? this.state.caps,
          max: event.caps?.maxSeats ?? this.state.max,
        });
        break;
      case 'token':
        if (
          this.state.room &&
          event.epoch === this.state.epoch &&
          event.revision > this.state.room.revision
        )
          this.patch({
            room: {
              ...this.state.room,
              revision: event.revision,
              tokens: this.state.room.tokens.map((t) =>
                t.id === event.token.id ? event.token : t,
              ),
            },
          });
        break;
      case 'music':
        this.patch({
          music: event.music,
          musicConsent: event.acceptedPushId
            ? { pushId: event.acceptedPushId }
            : this.state.musicConsent,
        });
        break;
      case 'presence':
        this.patch({ count: event.count, max: event.max });
        break;
      case 'saved':
        this.patch({ savedRevision: Math.max(this.state.savedRevision, event.revision) });
        break;
      case 'error':
        this.patch({ error: event.message });
        break;
      case 'idle':
        this.patch({ notice: `约 ${event.seconds} 秒后因无操作断开；操作网页即可继续在线。` });
        break;
    }
  }
  send = (command: Command) => {
    if (
      command.type === 'move' &&
      (!coordinate.safeParse(command.x).success || !coordinate.safeParse(command.y).success)
    ) {
      this.patch({ error: '坐标超出桌面范围' });
      return false;
    }
    if (this.ws?.readyState !== WebSocket.OPEN) {
      this.patch({ error: '当前未连接，操作没有同步' });
      return false;
    }
    if (this.ws.bufferedAmount > 64 * 1024) {
      this.patch({ error: '网络拥堵，请稍后重试' });
      return false;
    }
    this.ws.send(JSON.stringify(command));
    return true;
  };
  activity = (force = false) => {
    const now = Date.now();
    if (force || now - this.lastActivity > 10000) {
      this.lastActivity = now;
      if (this.state.connection === 'connected') {
        this.send({ type: 'activity' });
        if (this.state.notice.startsWith('约 ')) this.patch({ notice: '' });
      }
    }
  };
  cloneToken = (id: string): string | null => {
    const { room, caps, dm, connection } = this.state;
    const token = room?.tokens.find((t) => t.id === id);
    if (
      !dm ||
      connection !== 'connected' ||
      !token ||
      !caps ||
      room!.tokens.length >= caps.maxTokens
    )
      return null;
    const copyId = crypto.randomUUID();
    // Keep a nearby clone legal even at the positive world boundary.
    const offset = (value: number) => (value + 24 <= WORLD_LIMIT ? value + 24 : value - 24);
    return this.send({
      type: 'create',
      token: {
        ...token,
        secret: token.secret ?? '',
        id: copyId,
        x: offset(token.x),
        y: offset(token.y),
      },
    })
      ? copyId
      : null;
  };
  deleteTokens = (ids: string[]) =>
    this.send({ type: 'delete.many', ids, epoch: this.state.epoch });
  move = (id: string, x: number, y: number, final: boolean) =>
    this.send({ type: 'move', id, x, y, final, epoch: this.state.epoch });
  rotate = (t: PublicToken, delta: number) =>
    this.send({ type: 'rotate', id: t.id, angle: t.angle + delta, epoch: this.state.epoch });
  editNote = (id: string, note: string) =>
    this.send({ type: 'note', id, note, epoch: this.state.epoch });
  putInitiative = (entry: import('../shared/model').InitiativeEntry) =>
    this.send({ type: 'initiative.put', entry, epoch: this.state.epoch });
  deleteInitiative = (id: string) =>
    this.send({ type: 'initiative.delete', id, epoch: this.state.epoch });
  orderInitiative = (ascending: boolean) =>
    this.send({ type: 'initiative.order', ascending, epoch: this.state.epoch });
  addDrawing = (drawing: import('../shared/model').Drawing) =>
    this.send({ type: 'drawing.add', drawing, epoch: this.state.epoch });
  deleteDrawing = (id: string) =>
    this.send({ type: 'drawing.delete', id, epoch: this.state.epoch });
  clearDrawings = () => this.send({ type: 'drawing.clear', epoch: this.state.epoch });
  async upload(file: File, kind: 'map' | 'token') {
    return this.request<{ asset: string; width: number; height: number; uploadId?: string }>(
      `/api/image/${kind}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-File-Name': encodeURIComponent(file.name),
        },
        body: file,
      },
    );
  }
  async cancelUpload(uploadId: string) {
    return this.request('/api/upload/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadId }),
    });
  }
  async uploadMusic(file: File) {
    return this.request('/api/music', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-File-Name': encodeURIComponent(file.name),
      },
      body: file,
    });
  }
  async changePasswords(input: PasswordChange) {
    return this.request('/api/passwords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }
  async restore(file: File) {
    return this.request('/api/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/zip' },
      body: file,
    });
  }
  async backup() {
    const res = await fetch('/api/backup', { headers: { Authorization: `Bearer ${this.token}` } });
    if (!res.ok) throw Error((await res.json()).error);
    download(await res.blob(), 'SMALLTABLE-backup.zip');
  }
}
export function download(data: Blob, name: string) {
  const a = document.createElement('a'),
    url = URL.createObjectURL(data);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const smalltable = new SmalltableClient();
