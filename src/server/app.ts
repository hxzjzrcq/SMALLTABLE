import { logEvent } from './log.js';
import express, { type Request } from 'express';
import { createServer } from 'node:http';
import { randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'node:path';
import {
  createCommandSchema,
  parseRoom,
  initialRoom,
  project,
  publicToken,
  type Command,
  type Room,
  type ServerEvent,
} from '../shared/model.js';
import { rollDice } from '../shared/dice.js';
import { Limiter } from './auth.js';
import type { CredentialStore } from './credentials.js';
import { canCommand, canHttp, type HttpOperation } from './permissions.js';
import { passwordChangeSchema } from '../shared/passwords.js';
import { Music } from './music.js';
import { inspectMp3 } from './mp3.js';
import { audioId } from '../shared/music.js';
import { Storage } from './storage.js';
import { backupLimits, type Config } from './config.js';
import { Sessions, type Session } from './sessions.js';
import { SESSION_CLOSE, SessionError, temporaryId } from '../shared/session.js';
export type CredentialAccess = Pick<CredentialStore, 'roomMatches' | 'dmMatches' | 'change'>;
export async function createSmalltable(
  cfg: Config,
  credentials: CredentialAccess,
  options: { now?: () => number } = {},
) {
  const { mapBytes, mapPixels, mapEdge, tokenBytes, tokenEdge } = cfg.caps;
  const budgets = backupLimits(cfg.caps);
  const storage = new Storage({
    dataDir: cfg.dataDir,
    images: { mapBytes, mapPixels, mapEdge, tokenBytes, tokenEdge },
    backup: budgets,
    resourceBytes: cfg.caps.resourceBytes,
    parse: (input) => parseRoom(input, cfg.caps),
  });
  const music = new Music(cfg.dataDir, cfg.caps, () =>
    broadcast({ type: 'music', music: music.snapshot() }),
  );
  await music.load();
  const commandSchema = createCommandSchema(cfg.caps);
  let room: Room = (await storage.load()) ?? initialRoom();
  await storage.collect(room, music.tracks);
  await storage.assertBudget();
  let epoch = 0,
    credentialGeneration = 0;
  const sessions = new Sessions(cfg.caps, () => presence(), options.now),
    loginLimiter = new Limiter(20, 0.1),
    dmLimiter = new Limiter(5, 0.05),
    passwordLimiter = new Limiter(5, 0.05),
    uploadLimiter = new Limiter(4, 0.05);
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: Math.max(
      64 * 1024,
      cfg.caps.maxNames * 1024 + 1024,
      (cfg.caps.maxTokens + 26) * 40 + 1024,
    ),
    perMessageDeflate: false,
    handleProtocols: () => 'tabletop',
  });
  wss.on('error', (error) => logEvent('websocket.error', { error }));
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
    if (!sessions.valid(s) || s.ws?.readyState !== WebSocket.OPEN) return;
    if (s.ws.bufferedAmount > 1024 * 1024) {
      logEvent('websocket.rejected', { reason: 'slow_client' });
      s.ws.close(4008, '连接过慢，请重连');
      return;
    }
    s.ws.send(JSON.stringify(event));
  };
  const broadcast = (event: ServerEvent) => {
    for (const s of sessions.values()) send(s, event);
  };
  function presence() {
    const online = [...sessions.values()].filter((s) => sessions.online(s));
    broadcast({
      type: 'presence',
      count: online.filter((s) => !s.dm).length,
      max: cfg.caps.maxSeats,
      dms: online.filter((s) => s.dm).length,
      maxDMs: cfg.caps.maxDMs,
    });
    const players = online.map((s) => ({ target: s.target!, name: s.name, dm: s.dm }));
    for (const s of online) if (s.dm) send(s, { type: 'players', players });
  }
  const snapshot = (s: Session) => {
    send(s, { type: 'snapshot', room: project(room, s.dm), dm: s.dm, epoch, caps: cfg.caps });
    send(s, { type: 'saved', revision: savedRevision });
    send(s, { type: 'music', music: music.snapshot() });
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
      logEvent('storage.save_failed', { error: e });
      broadcast({ type: 'error', code: 'SAVE_FAILED', message: '服务器保存失败，尚未安全落盘' });
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
  async function cleanupResources() {
    try {
      await storage.collect(room, music.tracks);
    } catch (error) {
      logEvent('resource.cleanup_failed', { error });
      broadcast({ type: 'error', message: '资源清理失败，容量尚未释放' });
    }
  }
  async function commitRoom(candidate: Room, invalidate = false) {
    candidate.revision = room.revision + 1;
    try {
      await storage.save(candidate);
    } catch (error) {
      logEvent('storage.save_failed', { error });
      throw Error('保存失败，变更未提交');
    }
    room = candidate;
    if (invalidate) epoch++;
    savedRevision = room.revision;
    dirty = false;
    saveError = false;
    await cleanupResources();
    snapshots();
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
  const cookieToken = (req: Request | import('node:http').IncomingMessage) =>
    req.headers.cookie
      ?.split(';')
      .map((x) => x.trim())
      .find((x) => x.startsWith('tt_room='))
      ?.slice(8);
  const auth = (req: Request) => {
    const s = sessions.get(
      req.headers.authorization?.replace(/^Bearer /, '') ?? cookieToken(req) ?? '',
    );
    return sessions.valid(s) ? s : undefined;
  };
  const setCookie = (res: express.Response, s?: Session) =>
    res.setHeader(
      'Set-Cookie',
      `tt_room=${s?.id ?? ''}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${s ? Math.max(1, Math.ceil(((s.disconnectedUntil ?? sessions.now() + 45 * 60000) - sessions.now()) / 1000)) : 0}${cfg.cookieSecure ? '; Secure' : ''}`,
    );
  const sessionResponse = (res: express.Response, s: Session) => {
    setCookie(res, s);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ dm: s.dm, name: s.name });
  };
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
  const requireHttp = (req: Request, operation: HttpOperation) => {
    const s = auth(req);
    if (!canHttp(s, operation)) {
      if (
        !['GET /api/config', 'POST /api/login', 'GET /api/health', 'GET /media/:id'].includes(
          operation,
        )
      )
        logEvent('auth.dm_failed', { reason: 'denied' });
      throw Error('需要有效会话及对应权限');
    }
    return s;
  };
  app.get('/api/config', (req, res) => {
    requireHttp(req, 'GET /api/config');
    res.json(cfg.caps);
  });
  app.post('/api/login', express.json({ limit: '2kb' }), async (req, res, next) => {
    try {
      requireHttp(req, 'POST /api/login');
      if (!loginLimiter.take(req.socket.remoteAddress ?? '')) {
        logEvent('rate_limit.triggered', { scope: 'login' });
        return res.status(429).json({ error: '尝试过于频繁，请稍后重试' });
      }
      if (!temporaryId(req.body?.name).valid)
        throw new SessionError('INVALID_ID', '临时 ID 须为 1–16 单位的英文字母、数字或汉字', 400);
      const generation = credentialGeneration;
      const previous = auth(req);
      const password = req.body?.password;
      const roomMatch = await credentials.roomMatches(password);
      let dm = false;
      if (!roomMatch) {
        dm = await credentials.dmMatches(password);
      }
      if (generation !== credentialGeneration)
        throw new SessionError('CREDENTIALS_CHANGED', '口令已更换，请重新进入', 403);
      if (!roomMatch && !dm) {
        logEvent('auth.login_failed', { reason: 'invalid_credentials' });
        throw new SessionError('INVALID_PASSWORD', '房间密码错误', 403);
      }
      // No await between final policy checks and reservation / replacement.
      const current = auth(req);
      if (previous && current !== previous)
        throw new SessionError('EXPIRED', '原会话已失效，请重新登录', 401);
      sessions.check(req.body.name, dm, current);
      if (current) sessions.revoke(current, 'REPLACED', '此会话已在其他页面打开');
      const session = sessions.create(req.body.name, dm);
      sessionResponse(res, session);
    } catch (e) {
      next(e);
    }
  });
  app.post('/api/logout', (req, res) => {
    const s = auth(req);
    if (s) sessions.revoke(s, 'LOGGED_OUT', '已离开房间');
    setCookie(res);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ok: true });
  });
  app.use('/api', (req, res, next) => {
    if (!auth(req)) return res.status(401).json({ code: 'EXPIRED', error: '请重新输入房间密码' });
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.get('/api/session', (req, res) => {
    sessionResponse(res, requireHttp(req, 'GET /api/session')!);
  });
  app.post('/api/session', (req, res, next) => {
    try {
      const s = requireHttp(req, 'POST /api/session')!;
      sessions.reserve(s);
      sessionResponse(res, s);
    } catch (e) {
      next(e);
    }
  });
  const requireDM = (req: Request, operation: HttpOperation) => {
    const s = requireHttp(req, operation);
    if (!s || !sessions.online(s)) {
      logEvent('auth.dm_failed', { reason: 'denied' });
      throw Error('需要解锁 DM 工具箱');
    }
    return s;
  };
  app.post('/api/passwords', express.json({ limit: '4kb' }), async (req, res, next) => {
    try {
      requireDM(req, 'POST /api/passwords');
      if (!passwordLimiter.take(req.socket.remoteAddress ?? '')) {
        logEvent('rate_limit.triggered', { scope: 'password_change' });
        throw Error('密码尝试过于频繁，请稍后重试');
      }
      const input = passwordChangeSchema.parse(req.body);
      await enqueue(async () => {
        requireDM(req, 'POST /api/passwords');
        try {
          await credentials.change(input);
        } catch (error) {
          logEvent('auth.dm_failed', { error, scope: 'password_change' });
          throw error;
        }
        credentialGeneration++;
        if (input.roomPassword !== undefined) {
          for (const s of [...sessions.values()])
            sessions.revoke(s, 'CREDENTIALS_CHANGED', '房间口令已更换，请重新进入');
        } else {
          for (const s of [...sessions.values()])
            if (s.source === 'dm')
              sessions.revoke(s, 'CREDENTIALS_CHANGED', 'DM 密码已更换，请重新进入');
          for (const s of [...sessions.values()].sort((a, b) => a.order - b.order))
            if (sessions.valid(s)) sessions.demote(s);
          snapshots();
          presence();
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
      requireDM(req, 'GET /api/backup');
      const data = await enqueue(async () => {
        requireDM(req, 'GET /api/backup');
        await persist();
        if (saveError) throw Error('保存失败，暂不能导出');
        return storage.backup(structuredClone(room));
      });
      res.type('application/zip').attachment('SMALLTABLE-backup.zip').send(data);
    } catch (e) {
      next(e);
    }
  });
  const maxBackup = budgets.bytes;
  app.post(
    '/api/restore',
    (req, res, next) => {
      try {
        requireDM(req, 'POST /api/restore');
        if (!uploadLimiter.take(auth(req)!.id)) {
          logEvent('rate_limit.triggered', { scope: 'upload' });
          throw Error('上传过于频繁');
        }
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
          requireDM(req, 'POST /api/restore');
          await storage.collect(room, music.tracks);
          const prepared = await storage.prepareRestore(req.body);
          await prepared.checkBudget(room);
          try {
            await prepared.commitAssets();
            const nextRoom = prepared.room;
            nextRoom.revision = room.revision + 1;
            try {
              await storage.save(nextRoom);
            } catch (error) {
              logEvent('storage.save_failed', { error });
              throw error;
            }
            room = nextRoom;
            savedRevision = room.revision;
            epoch++;
            dirty = false;
            saveError = false;
            snapshots();
            broadcast({ type: 'saved', revision: room.revision });
          } finally {
            await storage.collect(room, music.tracks);
          }
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
        requireDM(req, 'POST /api/image/:kind');
        if (!['map', 'token'].includes(String(req.params.kind))) throw Error('未知图片用途');
        if (!uploadLimiter.take(auth(req)!.id)) {
          logEvent('rate_limit.triggered', { scope: 'upload' });
          throw Error('上传过于频繁');
        }
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
          requireDM(req, 'POST /api/image/:kind');
          const kind = req.params.kind as 'map' | 'token';
          if (kind === 'map' && room.maps.length >= cfg.caps.maxMaps)
            throw Error(`地图已达 ${cfg.caps.maxMaps} 张`);
          const name = decodeURIComponent(String(req.headers['x-file-name'] ?? '图片'));
          if (Buffer.byteLength(name) > 1024) throw Error('文件名过长');
          await storage.collect(room, music.tracks);
          const image = await storage.validateImage(req.body, kind);
          let asset: string | undefined;
          try {
            asset = await storage.install(image.data, 'webp');
            if (kind === 'map') {
              const candidate = structuredClone(room);
              const id = randomUUID();
              candidate.maps.push({
                id,
                name,
                asset,
                width: image.width,
                height: image.height,
                scale: 100,
              });
              candidate.currentMapId = id;
              await commitRoom(candidate);
              return { asset, width: image.width, height: image.height };
            }
            return {
              asset,
              width: image.width,
              height: image.height,
              uploadId: storage.temporary(asset, auth(req)!.id),
            };
          } catch (e) {
            await storage.collect(room, music.tracks);
            throw e;
          }
        });
        res.json(image);
      } catch (e) {
        next(e);
      }
    },
  );
  app.post('/api/upload/cancel', express.json({ limit: '2kb' }), async (req, res, next) => {
    try {
      requireDM(req, 'POST /api/upload/cancel');
      await enqueue(async () => {
        const session = requireDM(req, 'POST /api/upload/cancel');
        if (typeof req.body?.uploadId !== 'string') throw Error('缺少暂存 ID');
        storage.release(req.body.uploadId, session.id);
        await storage.collect(room, music.tracks);
      });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  app.post(
    '/api/music',
    (req, res, next) => {
      try {
        requireDM(req, 'POST /api/music');
        if (!uploadLimiter.take(auth(req)!.id)) throw Error('上传过于频繁');
        next();
      } catch (e) {
        next(e);
      }
    },
    express.raw({ type: 'application/octet-stream', limit: cfg.caps.musicBytes }),
    async (req, res, next) => {
      try {
        await enqueue(async () => {
          requireDM(req, 'POST /api/music');
          if (!Buffer.isBuffer(req.body) || req.body.length > cfg.caps.musicBytes)
            throw Error('音乐大小或格式无效');
          if (music.tracks.length >= cfg.caps.maxMusic)
            throw Error(`音乐已达 ${cfg.caps.maxMusic} 首`);
          const name = decodeURIComponent(String(req.headers['x-file-name'] ?? '音乐.mp3'));
          if (name.length > 1024) throw Error('文件名过长');
          const { duration } = inspectMp3(req.body);
          await storage.collect(room, music.tracks);
          try {
            const asset = await storage.install(req.body, 'mp3');
            await music.save([...music.tracks, { id: randomUUID(), name, asset, duration }]);
            broadcast({ type: 'music', music: music.snapshot() });
          } finally {
            await storage.collect(room, music.tracks);
          }
        });
        res.json({ ok: true });
      } catch (e) {
        next(e);
      }
    },
  );
  app.get('/audio/:id', (req, res) => {
    if (!canHttp(auth(req), 'GET /audio/:id')) return res.sendStatus(401);
    const id = String(req.params.id);
    if (!audioId.safeParse(id).success || !music.tracks.some((t) => t.asset === id))
      return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, no-store');
    res.type('audio/mpeg').sendFile(path.join(music.audioDir, id), (error) => {
      if (error && !res.headersSent)
        res.status((error as Error & { status?: number }).status === 416 ? 416 : 404).end();
    });
  });
  app.get('/media/:id', (req, res) => {
    if (!canHttp(auth(req), 'GET /media/:id')) return res.sendStatus(401);
    const id = String(req.params.id);
    if (!/^[a-f0-9]{64}\.webp$/.test(id)) return res.sendStatus(404);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(path.join(storage.assetDir, id));
  });
  app.get('/api/health', (req, res) => {
    requireHttp(req, 'GET /api/health');
    res.json({ ok: !saveError, revision: room.revision });
  });
  app.use(express.static(path.resolve('dist')));
  app.get('/', (_req, res) => res.sendFile(path.resolve('dist/index.html')));
  app.use((err: Error, req: Request, res: express.Response, _next: express.NextFunction) => {
    const route = req.route?.path;
    if (route === '/api/restore') logEvent('backup.restore_failed', { error: err });
    else if (route === '/api/backup') logEvent('backup.create_failed', { error: err });
    else if (route === '/api/image/:kind') logEvent('image.process_failed', { error: err });
    else if (route === '/api/music') logEvent('music.failed', { error: err });
    else if (route === '/api/login') logEvent('auth.login_failed', { error: err });
    res.status(err instanceof SessionError ? err.status : 400).json({
      code: err instanceof SessionError ? err.code : 'REQUEST_FAILED',
      error: err.message || '请求失败',
    });
  });
  server.on('upgrade', (req, socket, head) => {
    const protocols = String(req.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((x) => x.trim());
    const s = sessions.get(cookieToken(req) ?? protocols[1] ?? '');
    if (req.url !== '/ws' || !originOK(req) || protocols[0] !== 'tabletop' || !sessions.valid(s)) {
      logEvent('websocket.rejected', { reason: 'denied' });
      if (s && !sessions.online(s)) s.reservedUntil = 0;
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    // Complete WS protocol on admission failure so the client receives a machine-readable close code.
    try {
      sessions.reserve(s);
    } catch (error) {
      wss.handleUpgrade(req, socket, head, (ws) =>
        ws.close(
          error instanceof SessionError && error.code === 'ID_CONFLICT'
            ? SESSION_CLOSE.ID_CONFLICT
            : error instanceof SessionError && error.code === 'DM_FULL'
              ? SESSION_CLOSE.DM_FULL
              : SESSION_CLOSE.PLAYER_FULL,
          (error as Error).message,
        ),
      );
      return;
    }
    const releaseHandshake = () => {
      if (!sessions.online(s)) s.reservedUntil = 0;
    };
    socket.once('close', releaseHandshake);
    socket.once('error', releaseHandshake);
    wss.handleUpgrade(req, socket, head, (ws) => {
      socket.off('close', releaseHandshake);
      socket.off('error', releaseHandshake);
      sessions.attach(s, ws);
      snapshot(s);
      presence();
      ws.on('error', (error) => logEvent('websocket.error', { error }));
      ws.on('pong', () => {
        if (s.ws === ws) {
          s.alive = true;
          s.missed = 0;
        }
      });
      ws.on('close', () => {
        if (s.ws === ws) {
          sessions.detach(s, ws);
          void enqueue(persist);
        }
      });
      ws.on('message', (data, isBinary) => {
        if (s.ws !== ws || !sessions.valid(s)) return;
        const receivedEpoch = epoch;
        // Reject floods before they can occupy the serialized mutation queue.
        if (isBinary || !s.limiter.take('all')) {
          if (isBinary) logEvent('websocket.rejected', { reason: 'binary' });
          else logEvent('rate_limit.triggered', { scope: 'ws' });
          send(s, { type: 'error', message: '消息过快或格式无效' });
          return;
        }
        void enqueue(async () => {
          if (s.ws !== ws || !sessions.valid(s) || closed) return;
          let failedCommand: Command | undefined;
          try {
            const c = commandSchema.parse(JSON.parse(data.toString()));
            failedCommand = c;
            if (!canCommand(s, c.type)) {
              logEvent('auth.dm_failed', { reason: 'denied', scope: 'ws' });
              throw Error('操作未授权');
            }
            if (c.type === 'activity') {
              send(s, { type: 'activity' });
              return;
            }
            if (receivedEpoch !== epoch) throw Error('桌面已更新，请重新操作');
            if (c.type === 'unlock') {
              if (!dmLimiter.take(req.socket.remoteAddress ?? '')) {
                logEvent('rate_limit.triggered', { scope: 'dm' });
                throw Error('DM 密码尝试过于频繁');
              }
              const generation = credentialGeneration;
              if (!(await credentials.dmMatches(c.password))) {
                logEvent('auth.dm_failed', { reason: 'invalid_credentials' });
                throw Error('DM 密码错误');
              }
              if (generation !== credentialGeneration || !sessions.valid(s) || s.ws !== ws)
                throw Error('会话或口令已更新');
              sessions.role(s, true);
              snapshot(s);
              presence();
              return;
            }
            if (c.type === 'lock') {
              sessions.demote(s);
              if (sessions.valid(s)) snapshot(s);
              presence();
              return;
            }
            if (c.type === 'player.kick') {
              const target = [...sessions.values()].find((t) => t.target === c.target);
              if (
                !target ||
                !sessions.valid(target) ||
                !sessions.online(target) ||
                target.dm ||
                target === s
              )
                throw Error('列表已更新，请重新选择在线普通玩家');
              sessions.revoke(target, 'KICKED', '你已被 DM 移出房间');
              return;
            }
            if (c.type === 'map.select' || c.type === 'map.delete' || c.type === 'map.scale') {
              const candidate = structuredClone(room);
              const map = candidate.maps.find((m) => m.id === c.id);
              if (!map) throw Error('地图不存在');
              if (c.type === 'map.select') candidate.currentMapId = c.id;
              else if (c.type === 'map.scale') map.scale = c.scale;
              else {
                candidate.maps = candidate.maps.filter((m) => m.id !== c.id);
                if (candidate.currentMapId === c.id)
                  candidate.currentMapId = candidate.maps[0]?.id ?? null;
              }
              await commitRoom(candidate);
              return;
            }
            if (
              c.type === 'music.play' ||
              c.type === 'music.pause' ||
              c.type === 'music.stop' ||
              c.type === 'music.delete'
            ) {
              if (c.type === 'music.delete') {
                if (!music.tracks.some((t) => t.id === c.id)) throw Error('曲目不存在');
                await music.save(music.tracks.filter((t) => t.id !== c.id));
                music.removed(c.id);
                await cleanupResources();
                broadcast({ type: 'music', music: music.snapshot() });
              } else if (c.type === 'music.play') {
                music.control('play', c.id);
                send(s, {
                  type: 'music',
                  music: music.snapshot(),
                  acceptedPushId: music.snapshot().playback.pushId!,
                });
              } else music.control(c.type === 'music.pause' ? 'pause' : 'stop');
              return;
            }
            if (c.type === 'move' || c.type === 'rotate' || c.type === 'note') {
              if (c.epoch !== epoch) {
                snapshot(s);
                throw Error('桌面已更新，请重新操作');
              }
              const t = room.tokens.find((t) => t.id === c.id);
              if (!t) throw Error('棋子已不存在');
              if (t.publicId && c.type === 'note') throw Error('公共棋子不能修改说明');
              if (t.hidden && c.type !== 'note') throw Error('棋子已隐藏，不能移动或旋转');
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
              if (c.type === 'move' && c.final && c.moveId)
                send(s, {
                  type: 'move.ack',
                  id: t.id,
                  moveId: c.moveId,
                  epoch,
                  revision: room.revision,
                  ok: true,
                  x: t.x,
                  y: t.y,
                });
              return;
            }
            if (c.type === 'roll') {
              if (!s.rollLimiter.take('roll')) {
                logEvent('rate_limit.triggered', { scope: 'roll' });
                throw Error('投骰过于频繁');
              }
              if (!room.names.includes(c.name)) throw Error('请选择名单中的显示名称');
              room.rolls.push({
                id: randomUUID(),
                name: c.name,
                time: new Date().toISOString(),
                ...rollDice(c.expression, (n) => randomInt(1, n + 1)),
                ...(c.reason ? { reason: c.reason } : {}),
              });
              room.rolls = room.rolls.slice(-cfg.caps.maxRolls);
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
                    if (room.initiative.length >= cfg.caps.maxInitiative)
                      throw Error(`先攻条目已达 ${cfg.caps.maxInitiative}`);
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
                  if (room.drawings.length >= cfg.caps.maxDrawings)
                    throw Error(`线条已达 ${cfg.caps.maxDrawings}`);
                  if (room.drawings.some((d) => d.id === c.drawing.id)) throw Error('重复线条 ID');
                  room.drawings.push(c.drawing);
                  break;
                case 'drawing.delete':
                  room.drawings = room.drawings.filter((d) => d.id !== c.id);
                  break;
                case 'drawing.clear':
                  room.drawings = [];
                  break;
                default:
                  throw Error('未实现的房间命令');
              }
              changed(true);
              snapshots();
              return;
            }
            const candidate = structuredClone(room);
            switch (c.type) {
              case 'public.take':
                if (c.epoch !== epoch) throw Error('桌面已更新');
                if (candidate.tokens.some((t) => t.publicId === c.publicId))
                  throw Error('此公共棋子已在桌上');
                candidate.tokens.push({
                  id: randomUUID(),
                  publicId: c.publicId,
                  label: c.publicId,
                  name: '',
                  shape: 'circle',
                  color: '#3872a4',
                  size: 1,
                  angle: 0,
                  x: c.x,
                  y: c.y,
                  asset: null,
                  hidden: false,
                  note: '',
                  secret: '',
                });
                break;
              case 'token.label':
              case 'token.hidden': {
                if (c.epoch !== epoch) throw Error('桌面已更新');
                const t = candidate.tokens.find((t) => t.id === c.id);
                if (!t) throw Error('棋子不存在');
                if (c.type === 'token.hidden') {
                  if (t.publicId) throw Error('公共棋子不能隐藏');
                  t.hidden = c.hidden;
                } else {
                  if (!t.publicId && !s.dm) throw Error('操作未授权');
                  t.label = c.label;
                }
                break;
              }
              case 'create':
                if (c.token.publicId) throw Error('请通过公共盒取用');
                if (candidate.tokens.filter((t) => !t.publicId).length >= cfg.caps.maxTokens)
                  throw Error(`棋子数量已达 ${cfg.caps.maxTokens}`);
                if (candidate.tokens.some((t) => t.id === c.token.id)) throw Error('重复棋子 ID');
                if (c.token.asset) {
                  storage.checkBinding(c.token.asset, c.uploadId, s.id, room);
                  await storage.checkImage(c.token.asset, 'token');
                }
                candidate.tokens.push(c.token);
                break;
              case 'edit': {
                const i = candidate.tokens.findIndex((t) => t.id === c.token.id);
                if (i < 0) throw Error('棋子不存在');
                if (candidate.tokens[i].publicId || c.token.publicId)
                  throw Error('公共棋子仅允许改字、归还');
                if (c.token.asset && c.token.asset !== candidate.tokens[i].asset) {
                  storage.checkBinding(c.token.asset, c.uploadId, s.id, room);
                  await storage.checkImage(c.token.asset, 'token');
                }
                candidate.tokens[i] = {
                  ...c.token,
                  x: candidate.tokens[i].x,
                  y: candidate.tokens[i].y,
                  angle: candidate.tokens[i].angle,
                  hidden: candidate.tokens[i].hidden,
                };
                break;
              }
              case 'delete':
              case 'delete.many': {
                if (c.type === 'delete.many' && c.epoch !== epoch)
                  throw Error('桌面已更新，请重新操作');
                const ids = new Set(c.type === 'delete' ? [c.id] : c.ids);
                if (
                  !s.dm &&
                  (candidate.tokens.some((t) => ids.has(t.id) && !t.publicId) ||
                    (c.type === 'delete' && !candidate.tokens.some((t) => t.id === c.id)))
                )
                  throw Error('操作未授权');
                candidate.tokens = candidate.tokens.filter((t) => !ids.has(t.id));
                // Missing IDs may already have been deleted or returned; skip them.
                if (c.type === 'delete.many' && candidate.tokens.length === room.tokens.length) {
                  snapshot(s);
                  return;
                }
                break;
              }
              case 'clear':
                candidate.tokens = [];
                candidate.drawings = [];
                for (const p of sessions.values()) p.moveAt.clear();
                break;
              case 'grid':
                candidate.grid = c.grid;
                break;
              case 'names':
                if (c.names.some((n) => !n.trim())) throw Error('名称不能为空');
                candidate.names = [...new Set(c.names)];
                break;
              default:
                throw Error('未实现的房间命令');
            }
            parseRoom(candidate, cfg.caps);
            await commitRoom(candidate, c.type === 'clear' || c.type === 'grid');
            if (c.type === 'delete' || c.type === 'delete.many') {
              const ids = c.type === 'delete' ? [c.id] : c.ids;
              for (const p of sessions.values()) for (const id of ids) p.moveAt.delete(id);
            }
            if ((c.type === 'create' || c.type === 'edit') && c.uploadId) {
              storage.release(c.uploadId, s.id);
              await storage.collect(room, music.tracks);
            }
          } catch (e) {
            if (s.ws !== ws || !sessions.valid(s)) return;
            const c = failedCommand;
            if (c?.type === 'move' && c.final && c.moveId) {
              const t = room.tokens.find((t) => t.id === c.id);
              send(s, {
                type: 'move.ack',
                id: c.id,
                moveId: c.moveId,
                epoch,
                revision: room.revision,
                ok: false,
                x: t?.x,
                y: t?.y,
                message: e instanceof Error ? e.message : '移动失败',
              });
            }
            snapshot(s);
            send(s, {
              type: 'error',
              code:
                e instanceof Error && e.message.startsWith('保存失败')
                  ? 'SAVE_FAILED'
                  : 'COMMAND_FAILED',
              message: e instanceof Error ? e.message : '操作失败',
            });
          }
        });
      });
    });
  });
  const COLLECT_INTERVAL = 15 * 60 * 1000;
  let lastCollectAt = Date.now();
  const maintenance = setInterval(() => {
    const now = sessions.now();
    for (const s of [...sessions.values()]) {
      if (!sessions.valid(s)) continue;
      if (!s.ws) {
        if (s.reservedUntil <= now) s.reservedUntil = 0;
        continue;
      }
      sessions.heartbeat(s);
      if (s.ws) send(s, { type: 'activity' });
    }
    void enqueue(async () => {
      if (dirty) await persist();
      const now = Date.now();
      if (now - lastCollectAt >= COLLECT_INTERVAL) {
        // Count attempts too: a failed scan must not retry every 10 seconds.
        lastCollectAt = now;
        await storage.collect(room, music.tracks);
      }
    }).catch((error) => logEvent('resource.cleanup_failed', { error }));
  }, 10000);
  maintenance.unref();
  return {
    app,
    server,
    storage,
    music,
    getRoom: () => structuredClone(room),
    async close() {
      if (closed) return;
      closed = true;
      music.close();
      clearInterval(maintenance);
      if (pending) clearTimeout(pending);
      for (const ws of wss.clients) ws.terminate();
      await enqueue(persist);
      try {
        await new Promise<void>((r) => wss.close(() => r()));
        if (server.listening) await new Promise<void>((r) => server.close(() => r()));
      } finally {
        sessions.clear();
      }
    },
  };
}
