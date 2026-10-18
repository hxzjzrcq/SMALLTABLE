import express, { type Request } from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  commandSchema,
  initialRoom,
  project,
  publicToken,
  type Room,
  type ServerEvent,
} from '../shared/model.js';
import { rollDice } from '../shared/dice.js';
import { Limiter } from './auth.js';
import { CredentialStore } from './credentials.js';
import { passwordChangeSchema } from '../shared/passwords.js';
import { Storage } from './storage.js';
import type { Config } from './config.js';
interface Session {
  id: string;
  dm: boolean;
  lastActivity: number;
  created: number;
  ws?: WebSocket;
  alive: boolean;
  limiter: Limiter;
  rollLimiter: Limiter;
  moveAt: Map<string, number>;
  warned: boolean;
}
export async function createSmalltable(cfg: Config) {
  const storage = new Storage(cfg);
  const credentials = await CredentialStore.open(cfg.dataDir, cfg);
  let room: Room;
  try {
    room = (await storage.load()) ?? initialRoom();
  } catch (e) {
    await credentials.close();
    throw e;
  }
  let epoch = 0,
    credentialGeneration = 0;
  const sessions = new Map<string, Session>(),
    loginLimiter = new Limiter(20, 0.1),
    dmLimiter = new Limiter(5, 0.05),
    uploadLimiter = new Limiter(4, 0.05);
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 64 * 1024,
    perMessageDeflate: false,
    handleProtocols: () => 'tabletop',
  });
  let pending: ReturnType<typeof setTimeout> | undefined,
    dirty = false,
    closed = false,
    saveError = false,
    savedRevision = room.revision;
  let serial: Promise<unknown> = Promise.resolve();
  function enqueue<T>(fn: () => Promise<T> | T): Promise<T> {
    const task = serial.then(fn);
    serial = task.catch(() => {});
    return task;
  }
  const send = (s: Session, event: ServerEvent) => {
    if (s.ws?.readyState !== WebSocket.OPEN) return;
    if (s.ws.bufferedAmount > 1024 * 1024) {
      s.ws.close(4008, '连接过慢，请重连');
      return;
    }
    s.ws.send(JSON.stringify(event));
  };
  const broadcast = (event: ServerEvent) => {
    for (const s of sessions.values()) send(s, event);
  };
  const presence = () =>
    broadcast({
      type: 'presence',
      count: [...sessions.values()].filter((s) => s.ws).length,
      max: cfg.caps.maxSeats,
    });
  const snapshot = (s: Session) => {
    send(s, { type: 'snapshot', room: project(room, s.dm), dm: s.dm, epoch });
    send(s, { type: 'saved', revision: savedRevision });
  };
  const snapshots = () => {
    for (const s of sessions.values()) snapshot(s);
  };
  async function persist() {
    if (pending) {
      clearTimeout(pending);
      pending = undefined;
    }
    if (!dirty) return;
    const copy = structuredClone(room);
    dirty = false;
    try {
      await storage.save(copy);
      savedRevision = copy.revision;
      saveError = false;
      broadcast({ type: 'saved', revision: copy.revision });
    } catch (e) {
      dirty = true;
      saveError = true;
      console.error('保存失败', e);
      broadcast({ type: 'error', message: '服务器保存失败，尚未安全落盘' });
    }
  }
  function changed(immediate = false) {
    room.revision++;
    dirty = true;
    if (immediate) {
      if (pending) clearTimeout(pending);
      pending = setTimeout(() => void enqueue(persist), 150);
    } else if (!pending) pending = setTimeout(() => void enqueue(persist), 2000);
  }
  const originOK = (req: Request | import('node:http').IncomingMessage) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  };
  const cookieToken = (req: Request) =>
    req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('tt_room='))
      ?.slice(8);
  const auth = (req: Request) =>
    sessions.get(req.headers.authorization?.replace(/^Bearer /, '') ?? cookieToken(req) ?? '');
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' ws: wss:; frame-src 'self'; object-src 'none'; frame-ancestors 'self'; base-uri 'self'",
    );
    if (!originOK(req)) return res.status(403).json({ error: '来源不允许' });
    next();
  });
  app.get('/api/config', (_req, res) => res.json(cfg.caps));
  app.post('/api/login', express.json({ limit: '2kb' }), async (req, res, next) => {
    try {
      if (!loginLimiter.take(req.socket.remoteAddress ?? ''))
        return res.status(429).json({ error: '尝试过于频繁，请稍后重试' });
      if (sessions.size >= cfg.caps.maxSeats)
        return res.status(409).json({ error: '房间人数已满' });
      const generation = credentialGeneration;
      if (!(await credentials.roomMatches(req.body?.password)))
        return res.status(403).json({ error: '房间密码错误' });
      if (generation !== credentialGeneration)
        return res.status(403).json({ error: '房间口令已更换，请重新进入' });
      // Capacity checked again after asynchronous password verification.
      if (sessions.size >= cfg.caps.maxSeats)
        return res.status(409).json({ error: '房间人数已满' });
      const id = randomBytes(32).toString('hex');
      const now = Date.now();
      sessions.set(id, {
        id,
        dm: false,
        lastActivity: now,
        created: now,
        alive: true,
        limiter: new Limiter(50, 25),
        rollLimiter: new Limiter(4, 1),
        moveAt: new Map(),
        warned: false,
      });
      res.setHeader(
        'Set-Cookie',
        `tt_room=${id}; HttpOnly; SameSite=Strict; Path=/${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json({ token: id });
    } catch (e) {
      next(e);
    }
  });
  app.use('/api', (req, res, next) => {
    if (!auth(req)) return res.status(401).json({ error: '请重新输入房间密码' });
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const requireDM = (req: Request) => {
    const s = auth(req);
    if (!s?.dm || !s.ws) throw Error('需要解锁 DM 工具箱');
    return s;
  };
  app.post('/api/passwords', express.json({ limit: '4kb' }), async (req, res, next) => {
    try {
      requireDM(req);
      if (!dmLimiter.take(req.socket.remoteAddress ?? ''))
        throw Error('密码尝试过于频繁，请稍后重试');
      const input = passwordChangeSchema.parse(req.body);
      await enqueue(async () => {
        requireDM(req);
        await credentials.change(input);
        if (input.roomPassword !== undefined) {
          credentialGeneration++;
          for (const s of sessions.values()) {
            s.dm = false;
            s.ws?.close(4003, '房间口令已更换，请重新进入');
          }
          sessions.clear();
        } else {
          for (const s of sessions.values()) s.dm = false;
          snapshots();
          broadcast({ type: 'error', message: 'DM 密码已更换，请重新解锁工具箱' });
        }
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.get('/api/backup', async (req, res, next) => {
    try {
      requireDM(req);
      const data = await enqueue(async () => {
        requireDM(req);
        await persist();
        if (saveError) throw Error('保存失败，暂不能导出');
        return storage.backup(structuredClone(room));
      });
      res.type('application/zip').attachment('SMALLTABLE-backup.zip').send(data);
    } catch (e) {
      next(e);
    }
  });
  const maxBackup = cfg.caps.mapBytes + 255 * cfg.caps.tokenBytes + 8 * 1024 * 1024;
  app.post(
    '/api/restore',
    (req, res, next) => {
      try {
        requireDM(req);
        if (!uploadLimiter.take(auth(req)!.id)) throw Error('上传过于频繁');
        next();
      } catch (e) {
        next(e);
      }
    },
    express.raw({ type: 'application/zip', limit: maxBackup }),
    async (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body)) throw Error('需要 ZIP 备份');
        await enqueue(async () => {
          requireDM(req);
          const prepared = await storage.prepareRestore(req.body);
          await prepared.commitAssets();
          const nextRoom = prepared.room;
          nextRoom.revision = room.revision + 1;
          await storage.save(nextRoom);
          room = nextRoom;
          savedRevision = room.revision;
          epoch++;
          dirty = false;
          saveError = false;
          snapshots();
          broadcast({ type: 'saved', revision: room.revision });
        });
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );
  app.post(
    '/api/image/:kind',
    (req, res, next) => {
      try {
        requireDM(req);
        if (!['map', 'token'].includes(String(req.params.kind))) throw Error('未知图片用途');
        if (!uploadLimiter.take(auth(req)!.id)) throw Error('上传过于频繁');
        next();
      } catch (e) {
        next(e);
      }
    },
    express.raw({
      type: 'application/octet-stream',
      limit: Math.max(cfg.caps.mapBytes, cfg.caps.tokenBytes),
    }),
    async (req, res, next) => {
      try {
        if (!Buffer.isBuffer(req.body)) throw Error('需要图片二进制数据');
        const image = await enqueue(async () => {
          requireDM(req);
          const kind = req.params.kind as 'map' | 'token';
          await storage.collect(room);
          const image = await storage.put(req.body, kind);
          if (kind === 'map') {
            room.map = image;
            epoch++;
            changed(true);
            snapshots();
          }
          return image;
        });
        res.json(image);
      } catch (e) {
        next(e);
      }
    },
  );
  app.get('/media/:id', (req, res) => {
    if (!auth(req)) return res.sendStatus(401);
    const id = String(req.params.id);
    if (!/^[a-f0-9]{64}\.webp$/.test(id)) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.join(storage.assetDir, id));
  });
  app.get('/api/health', (_req, res) => res.json({ ok: !saveError, revision: room.revision }));
  app.use(express.static(path.resolve('dist')));
  app.get('/', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  app.use((err: Error, _req: Request, res: express.Response, _next: express.NextFunction) => {
    res.status(400).json({ error: err.message || '请求失败' });
  });
  server.on('upgrade', (req, socket, head) => {
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((x) => x.trim());
    const s = sessions.get(protocols[1] ?? '');
    if (req.url !== '/ws' || !originOK(req) || protocols[0] !== 'tabletop' || !s || s.ws) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      s.ws = ws;
      s.alive = true;
      snapshot(s);
      presence();
      ws.on('error', () => {});
      ws.on('pong', () => (s.alive = true));
      ws.on('close', () => {
        if (s.ws === ws) {
          sessions.delete(s.id);
          presence();
          void enqueue(persist);
        }
      });
      ws.on('message', (data, isBinary) => {
        // Reject floods before they can occupy the serialized mutation queue.
        if (isBinary || !s.limiter.take('all')) {
          send(s, { type: 'error', message: '消息过快或格式无效' });
          return;
        }
        void enqueue(async () => {
          if (!sessions.has(s.id) || closed) return;
          try {
            const c = commandSchema.parse(JSON.parse(data.toString()));
            if (c.type === 'activity') {
              s.lastActivity = Date.now();
              s.warned = false;
              return;
            }
            if (c.type === 'unlock') {
              if (!dmLimiter.take(req.socket.remoteAddress ?? ''))
                throw Error('DM 密码尝试过于频繁');
              if (!(await credentials.dmMatches(c.password))) throw Error('DM 密码错误');
              s.dm = true;
              snapshot(s);
              return;
            }
            if (c.type === 'lock') {
              s.dm = false;
              snapshot(s);
              return;
            }
            if (c.type === 'move' || c.type === 'rotate' || c.type === 'note') {
              if (c.epoch !== epoch) {
                snapshot(s);
                throw Error('桌面已更新，请重新操作');
              }
              const t = room.tokens.find((t) => t.id === c.id);
              if (!t) throw Error('棋子已不存在');
              if (c.type === 'move') {
                const now = Date.now(),
                  last = s.moveAt.get(t.id) ?? 0;
                if (!c.final && now - last < 95) return;
                s.moveAt.set(t.id, now);
                t.x = c.x;
                t.y = c.y;
                changed(c.final);
              } else if (c.type === 'note') {
                t.note = c.note;
                changed(true);
              } else {
                t.angle = ((c.angle % 360) + 360) % 360;
                changed(true);
              }
              for (const target of sessions.values())
                send(target, {
                  type: 'token',
                  token: publicToken(t, target.dm),
                  revision: room.revision,
                  epoch,
                });
              return;
            }
            if (c.type === 'roll') {
              if (!s.rollLimiter.take('roll')) throw Error('投骰过于频繁');
              if (!room.names.includes(c.name)) throw Error('请选择名单中的显示名称');
              room.rolls.push({
                id: randomUUID(),
                name: c.name,
                time: new Date().toISOString(),
                ...rollDice(c.expression, (n) => randomInt(1, n + 1)),
              });
              room.rolls = room.rolls.slice(-255);
              changed(true);
              snapshots();
              return;
            }
            if (c.type.startsWith('initiative.') || c.type.startsWith('drawing.')) {
              // Narrow the union through exact discriminants; validate before all mutations.
              if ('epoch' in c && c.epoch !== epoch) {
                snapshot(s);
                throw Error('桌面已更新，请重新操作');
              }
              switch (c.type) {
                case 'initiative.put': {
                  const i = room.initiative.findIndex((e) => e.id === c.entry.id);
                  if (i < 0) {
                    if (room.initiative.length >= 255) throw Error('先攻条目已达 255');
                    room.initiative.push(c.entry);
                  } else room.initiative[i] = c.entry;
                  break;
                }
                case 'initiative.delete':
                  room.initiative = room.initiative.filter((e) => e.id !== c.id);
                  break;
                case 'initiative.order':
                  room.initiativeAscending = c.ascending;
                  break;
                case 'drawing.add':
                  if (room.drawings.length >= 255) throw Error('线条已达 255');
                  if (room.drawings.some((d) => d.id === c.drawing.id)) throw Error('重复线条 ID');
                  room.drawings.push(c.drawing);
                  break;
                case 'drawing.delete':
                  room.drawings = room.drawings.filter((d) => d.id !== c.id);
                  break;
                case 'drawing.clear':
                  if (!s.dm) throw Error('需要解锁 DM 工具箱');
                  room.drawings = [];
                  break;
              }
              changed(true);
              snapshots();
              return;
            }
            if (!s.dm) throw Error('需要解锁 DM 工具箱');
            switch (c.type) {
              case 'create':
                if (room.tokens.length >= 255) throw Error('棋子数量已达 255');
                if (room.tokens.some((t) => t.id === c.token.id)) throw Error('重复棋子 ID');
                if (c.token.asset)
                  await storage.validateImage(
                    await readFile(path.join(storage.assetDir, c.token.asset)),
                    'token',
                  );
                room.tokens.push(c.token);
                break;
              case 'edit': {
                const i = room.tokens.findIndex((t) => t.id === c.token.id);
                if (i < 0) throw Error('棋子不存在');
                if (c.token.asset)
                  await storage.validateImage(
                    await readFile(path.join(storage.assetDir, c.token.asset)),
                    'token',
                  );
                room.tokens[i] = c.token;
                break;
              }
              case 'delete':
                room.tokens = room.tokens.filter((t) => t.id !== c.id);
                for (const p of sessions.values()) p.moveAt.delete(c.id);
                break;
              case 'clear':
                room.tokens = [];
                for (const p of sessions.values()) p.moveAt.clear();
                epoch++;
                break;
              case 'grid':
                room.grid = c.grid;
                epoch++;
                break;
              case 'names':
                if (c.names.some((n) => !n.trim())) throw Error('名称不能为空');
                room.names = [...new Set(c.names)];
                break;
            }
            changed(true);
            snapshots();
          } catch (e) {
            send(s, { type: 'error', message: e instanceof Error ? e.message : '操作失败' });
          }
        });
      });
    });
  });
  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (!s.ws) {
        if (now - s.created > 15000) sessions.delete(id);
        continue;
      }
      if (now - s.lastActivity >= cfg.caps.idleMs) {
        s.ws.close(4001, '长时间无操作，请重新进入');
        sessions.delete(id);
        presence();
        continue;
      }
      if (now - s.lastActivity >= cfg.caps.idleMs - 60000 && !s.warned) {
        s.warned = true;
        send(s, {
          type: 'idle',
          seconds: Math.ceil((cfg.caps.idleMs - (now - s.lastActivity)) / 1000),
        });
      }
      if (!s.alive) {
        s.ws.terminate();
        continue;
      }
      s.alive = false;
      s.ws.ping();
    }
    if (dirty) void enqueue(persist);
  }, 10000);
  maintenance.unref();
  return {
    app,
    server,
    storage,
    getRoom: () => structuredClone(room),
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(maintenance);
      if (pending) clearTimeout(pending);
      for (const s of sessions.values()) s.ws?.terminate();
      await enqueue(persist);
      try {
        await new Promise<void>((r) => wss.close(() => r()));
        if (server.listening) await new Promise<void>((r) => server.close(() => r()));
      } finally {
        await credentials.close();
      }
    },
  };
}
