import { version } from '../../package.json';
import {
  SESSION_CLOSE,
  SessionError,
  type SessionCode,
  type OnlinePlayer,
} from '../shared/session';
import type { MusicSnapshot } from '../shared/music';
import { coordinate, WORLD_LIMIT, tokenLabel } from '../shared/model';
import type { PasswordChange } from '../shared/passwords';
import type { Capabilities, Command, ServerEvent, View, PublicToken } from '../shared/model';
const closeCodes = new Map<number, SessionCode>(
  Object.entries(SESSION_CLOSE).map(([key, value]) => [value, key as SessionCode]),
);
export type Connection = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export interface ClientState {
  connection: Connection;
  recovery: 'checking' | 'socket' | 'snapshot' | 'retry' | null;
  room: View | null;
  dm: boolean;
  epoch: number;
  count: number;
  max: number;
  dms: number;
  maxDMs: number;
  players: OnlinePlayer[];
  resumable: boolean;
  errorCode?: string;
  retryCount: number;
  pendingMoves: Record<string, { moveId: string; x: number; y: number }>;
  uploads: Record<
    string,
    {
      phase: 'uploading' | 'processing' | 'done' | 'failed';
      name?: string;
      percent?: number;
      message?: string;
    }
  >;
  savedRevision: number;
  error: string;
  notice: string;
  caps: Capabilities | null;
  music?: MusicSnapshot;
  musicConsent?: { pushId: string };
}
const empty: ClientState = {
  connection: 'disconnected',
  retryCount: 0,
  pendingMoves: {},
  uploads: {},
  recovery: 'checking',
  room: null,
  dm: false,
  epoch: 0,
  count: 0,
  max: 0,
  dms: 0,
  maxDMs: 1,
  players: [],
  resumable: false,
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
  private sessionRequest?: Promise<{ dm: boolean; name: string }>;
  private initialized = false;
  private pendingLogout = false;
  private logoutRequest?: Promise<void>;
  private generation = 0;
  private snapshotTimer?: ReturnType<typeof setTimeout>;
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private attempts = 0;
  private moveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private uploadBusy = new Set<string>();
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
      this.patch({ caps, max: caps.maxSeats, maxDMs: caps.maxDMs });
    } catch (e) {
      this.fail(e);
    }
  }
  private fail(e: unknown) {
    this.patch({
      error: e instanceof Error ? e.message : String(e),
      errorCode: e instanceof SessionError ? e.code : 'REQUEST_FAILED',
    });
  }
  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(url, { credentials: 'same-origin', ...init });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      let code: string | undefined;
      try {
        const data = await res.json();
        message = data.error ?? message;
        code = data.code;
      } catch {}
      if (code && code !== 'REQUEST_FAILED')
        throw new SessionError(code as SessionCode, message, res.status);
      throw Error(message);
    }
    return res.json();
  }
  private logoutPending() {
    try {
      return this.pendingLogout || localStorage.getItem('smalltable.logout-pending') === '1';
    } catch {
      return this.pendingLogout;
    }
  }
  private markLogout(value: boolean) {
    this.pendingLogout = value;
    try {
      if (value) localStorage.setItem('smalltable.logout-pending', '1');
      else localStorage.removeItem('smalltable.logout-pending');
    } catch {}
  }
  initialize = async () => {
    if (this.initialized) return;
    this.initialized = true;
    if (this.logoutPending()) {
      await this.finishLogout();
      this.patch({ recovery: null });
      return;
    }
    await this.connect(false);
  };
  online = () => {
    if (this.logoutPending()) void this.finishLogout();
  };
  private reset(keepDesktop = false) {
    this.generation++;
    this.clearMoves();
    clearTimeout(this.snapshotTimer);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
    this.ws?.close();
    this.ws = undefined;
    this.patch({
      room:
        keepDesktop && this.state.room
          ? {
              ...this.state.room,
              tokens: this.state.room.tokens.map(({ secret, ...token }) => token),
            }
          : null,
      dm: false,
      players: [],
      music: undefined,
      musicConsent: undefined,
      count: 0,
      dms: 0,
      savedRevision: -1,
      connection: 'disconnected',
      recovery: null,
      error: '',
      notice: '',
      resumable: false,
    });
  }
  async join(password: string, name: string) {
    if (this.logoutPending()) {
      await this.finishLogout();
      if (this.logoutPending()) return;
    }
    this.attempts = 0;
    await this.connect(false, { password, name });
  }
  retry = async () => {
    this.attempts = 0;
    this.patch({ retryCount: 0 });
    await this.connect(false);
  };
  private async connect(retry: boolean, login?: { password: string; name: string }) {
    const gen = ++this.generation;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.snapshotTimer);
    this.patch({
      connection: retry ? 'reconnecting' : 'connecting',
      recovery: !login && !this.state.room ? 'checking' : null,
      error: '',
      notice: '',
    });
    try {
      const previous = this.sessionRequest;
      const request = (async () => {
        await previous?.catch(() => {});
        if (gen !== this.generation) throw Error('连接已取消');
        return this.request<{ dm: boolean; name: string }>(login ? '/api/login' : '/api/session', {
          method: 'POST',
          signal: AbortSignal.timeout(15000),
          headers: { 'Content-Type': 'application/json' },
          ...(login ? { body: JSON.stringify(login) } : {}),
        });
      })();
      this.sessionRequest = request;
      await request.finally(() => {
        if (this.sessionRequest === request) this.sessionRequest = undefined;
      });
      if (gen !== this.generation) return;
      this.patch({ resumable: true, recovery: !login && !this.state.room ? 'socket' : null });
      const ws = new WebSocket(
        `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
        ['tabletop'],
      );
      this.ws = ws;
      this.snapshotTimer = setTimeout(() => {
        if (gen === this.generation) ws.close(1000, '桌面同步超时');
      }, 15000);
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
        this.patch({
          connection: 'connecting',
          notice: '正在同步桌面…',
          errorCode: undefined,
          recovery: this.state.recovery ? 'snapshot' : null,
        });
      };
      ws.onerror = () => {};
      ws.onclose = (event) => {
        if (gen !== this.generation) return;
        const code = closeCodes.get(event.code);
        const resumable = code === 'PLAYER_FULL' || code === 'DM_FULL';
        this.reset(!code || resumable);
        this.patch({
          notice:
            code === 'ID_CONFLICT'
              ? '原临时 ID 已被使用，请更换 ID 并重新登录'
              : event.reason || '连接断开，正在重连；当前画面为断线前状态',
          errorCode: code,
          resumable: !code || resumable,
          recovery: resumable && !this.state.room ? 'retry' : null,
        });
        if (!code) this.scheduleRetry();
      };
    } catch (e) {
      if (gen !== this.generation) return;
      const code = e instanceof SessionError ? e.code : undefined;
      const full = code === 'PLAYER_FULL' || code === 'DM_FULL';
      const canRetry = full || !code;
      this.reset(!login && canRetry);
      this.patch({
        error:
          code === 'ID_CONFLICT'
            ? '原临时 ID 已被使用，请更换 ID 并重新登录'
            : code === 'EXPIRED' && !retry && !login
              ? ''
              : e instanceof Error
                ? e.message
                : String(e),
        errorCode: code,
        resumable: canRetry,
        recovery: canRetry && !login && !this.state.room ? 'retry' : null,
      });
      if (!code && !login) this.scheduleRetry();
    }
  }
  private scheduleRetry() {
    if (this.logoutPending()) return;
    if (this.attempts >= 10) {
      this.patch({
        connection: 'disconnected',
        resumable: true,
        notice: '重连失败，可手动重试或离开房间',
        recovery: this.state.room ? null : 'retry',
        error: '',
      });
      return;
    }
    this.patch({
      connection: 'reconnecting',
      retryCount: this.attempts + 1,
      recovery: this.state.room ? null : 'checking',
    });
    this.reconnectTimer = setTimeout(
      () => void this.connect(true),
      Math.min(8000, 1000 * 2 ** ++this.attempts),
    );
  }
  leave = async () => {
    this.markLogout(true);
    this.reset();
    await this.finishLogout();
  };
  private finishLogout(): Promise<void> {
    if (this.logoutRequest) return this.logoutRequest;
    this.logoutRequest = (async () => {
      try {
        await this.sessionRequest?.catch(() => {});
        await this.request('/api/logout', { method: 'POST' });
        this.markLogout(false);
        this.patch({ notice: '已离开房间', error: '' });
      } catch {
        this.patch({ notice: '已在本地退出，服务器注销待联网完成', error: '' });
      } finally {
        this.logoutRequest = undefined;
      }
    })();
    return this.logoutRequest;
  }
  private receive(event: ServerEvent) {
    switch (event.type) {
      case 'snapshot':
        if (
          event.epoch !== this.state.epoch ||
          event.room.currentMapId !== this.state.room?.currentMapId
        )
          this.clearMoves();
        else
          for (const id of Object.keys(this.state.pendingMoves))
            if (!event.room.tokens.some((t) => t.id === id && !t.hidden)) this.clearMove(id);
        clearTimeout(this.snapshotTimer);
        this.attempts = 0;
        this.patch({
          recovery: null,
          connection: 'connected',
          retryCount: 0,
          notice: '',
          players: event.dm ? this.state.players : [],
          room: event.room,
          dm: event.dm,
          epoch: event.epoch,
          caps: event.caps ?? this.state.caps,
          max: event.caps?.maxSeats ?? this.state.max,
        });
        break;
      case 'move.ack': {
        const pending = this.state.pendingMoves[event.id];
        if (event.epoch !== this.state.epoch || !pending || pending.moveId !== event.moveId) break;
        if (
          event.x !== undefined &&
          event.y !== undefined &&
          this.state.room &&
          event.revision >= this.state.room.revision
        ) {
          this.patch({
            room: {
              ...this.state.room,
              revision: event.revision,
              tokens: this.state.room.tokens.map((t) =>
                t.id === event.id ? { ...t, x: event.x!, y: event.y! } : t,
              ),
            },
          });
        }
        this.clearMove(event.id);
        if (!event.ok)
          this.patch({ error: event.message ?? '移动被拒绝', errorCode: 'MOVE_REJECTED' });
        break;
      }
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
      case 'players':
        if (this.state.dm) this.patch({ players: event.players });
        break;
      case 'activity':
        // Renew persistent cookie from remaining server lifetime, without advancing activity.
        void this.request('/api/session').catch(() => {});
        break;
      case 'presence':
        this.patch({ count: event.count, max: event.max, dms: event.dms, maxDMs: event.maxDMs });
        break;
      case 'saved':
        this.patch({ savedRevision: Math.max(this.state.savedRevision, event.revision) });
        break;
      case 'error':
        this.patch({ error: event.message, errorCode: event.code ?? 'COMMAND_FAILED' });
        break;
      case 'idle':
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
    if (this.state.connection !== 'connected' || this.ws?.readyState !== WebSocket.OPEN) {
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
  // Kept for embedded-tool compatibility; online lifetime is server driven.
  activity = (_force = false) => {};
  reportError = (message: string, code = 'SYNC_DELAY') =>
    this.patch({ error: message, errorCode: code });
  diagnostic = () =>
    JSON.stringify(
      {
        version,
        time: new Date().toISOString(),
        code: this.state.errorCode ?? 'CONNECTION',
        connection: this.state.connection,
        retryCount: this.state.retryCount,
        epoch: this.state.epoch,
        revision: this.state.room?.revision,
        savedRevision: this.state.savedRevision,
      },
      null,
      2,
    );
  private clearMove(id: string) {
    clearTimeout(this.moveTimers.get(id));
    this.moveTimers.delete(id);
    const pendingMoves = { ...this.state.pendingMoves };
    delete pendingMoves[id];
    this.patch({ pendingMoves });
  }
  clearMoves = () => {
    for (const timer of this.moveTimers.values()) clearTimeout(timer);
    this.moveTimers.clear();
    this.patch({ pendingMoves: {} });
  };
  cloneToken = (id: string): string | null => {
    const { room, caps, dm, connection } = this.state;
    const token = room?.tokens.find((t) => t.id === id);
    if (
      !dm ||
      connection !== 'connected' ||
      !token ||
      !caps ||
      room!.tokens.filter((t) => !t.publicId).length >= caps.maxTokens
    )
      return null;
    const copyId = crypto.randomUUID();
    // Keep a nearby clone legal even at the positive world boundary.
    const offset = (value: number) => (value + 24 <= WORLD_LIMIT ? value + 24 : value - 24);
    return this.send({
      type: 'create',
      token: {
        ...token,
        publicId: undefined,
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
  move = (id: string, x: number, y: number, final: boolean) => {
    const moveId = final ? crypto.randomUUID() : undefined;
    if (!this.send({ type: 'move', id, x, y, final, moveId, epoch: this.state.epoch }))
      return false;
    if (moveId) {
      this.clearMove(id);
      this.patch({ pendingMoves: { ...this.state.pendingMoves, [id]: { moveId, x, y } } });
      this.moveTimers.set(
        id,
        setTimeout(() => {
          if (this.state.pendingMoves[id]?.moveId !== moveId) return;
          this.clearMove(id);
          this.reportError('移动同步延迟，已回到最近同步位置');
        }, 2000),
      );
    }
    return true;
  };
  setLabel = (id: string, label: string) => {
    const parsed = tokenLabel.safeParse(label);
    if (!parsed.success) {
      this.reportError('棋面文字须为 1–4 个字符，不能含换行或控制字符', 'INVALID_LABEL');
      return false;
    }
    return this.send({ type: 'token.label', id, label: parsed.data, epoch: this.state.epoch });
  };
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
  private uploadFile<T>(
    file: File,
    url: string,
    key: string,
    contentType = 'application/octet-stream',
  ): Promise<T> {
    if (this.uploadBusy.has(key)) return Promise.reject(Error('此入口正在上传或处理'));
    this.uploadBusy.add(key);
    const status = (value: ClientState['uploads'][string]) =>
      this.patch({ uploads: { ...this.state.uploads, [key]: { name: file.name, ...value } } });
    status({ phase: 'uploading' });
    return new Promise<T>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.timeout = 120000;
      xhr.setRequestHeader('Content-Type', contentType);
      xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
      xhr.upload.onprogress = (e) =>
        status({
          phase: 'uploading',
          percent: e.lengthComputable ? Math.floor((e.loaded / e.total) * 100) : undefined,
        });
      xhr.upload.onload = () => status({ phase: 'processing' });
      const fail = (message: string) => {
        this.uploadBusy.delete(key);
        status({ phase: 'failed', message });
        this.reportError(message, key === 'restore' ? 'RESTORE_FAILED' : 'UPLOAD_FAILED');
        reject(Error(message));
      };
      xhr.onerror = () => fail('网络错误，请保留文件并重试');
      xhr.ontimeout = () => fail('请求超时，请检查房间状态后重试');
      xhr.onabort = () => fail('上传已取消');
      xhr.onload = () => {
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          fail('服务器响应无效');
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          fail(data.error ?? '上传失败');
          return;
        }
        this.uploadBusy.delete(key);
        status({ phase: 'done' });
        resolve(data);
      };
      xhr.send(file);
    });
  }
  async upload(file: File, kind: 'map' | 'token') {
    return this.uploadFile<{ asset: string; width: number; height: number; uploadId?: string }>(
      file,
      `/api/image/${kind}`,
      kind,
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
    return this.uploadFile(file, '/api/music', 'music');
  }
  async changePasswords(input: PasswordChange) {
    return this.request('/api/passwords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  }
  async restore(file: File) {
    return this.uploadFile(file, '/api/restore', 'restore', 'application/zip');
  }
  async backup() {
    try {
      const res = await fetch('/api/backup');
      if (!res.ok) throw Error((await res.json()).error);
      download(await res.blob(), 'SMALLTABLE-backup.zip');
    } catch (e) {
      this.reportError(e instanceof Error ? e.message : '备份失败', 'BACKUP_FAILED');
      throw e;
    }
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
