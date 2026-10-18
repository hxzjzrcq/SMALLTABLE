import { mkdir, readFile, writeFile, rename, unlink, readdir, open, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import AdmZip from 'adm-zip';
import { assetId, parseRoom, type Room } from '../shared/model.js';
import type { Config } from './config.js';
export class Storage {
  private chain: Promise<void> = Promise.resolve();
  readonly assetDir: string;
  constructor(readonly cfg: Config) {
    this.assetDir = path.join(cfg.dataDir, 'assets');
  }
  async load(): Promise<Room | null> {
    await mkdir(this.assetDir, { recursive: true });
    try {
      return parseRoom(
        JSON.parse(await readFile(path.join(this.cfg.dataDir, 'room.json'), 'utf8')),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw Error('存档损坏，拒绝覆盖；请恢复备份', { cause: e });
    }
  }
  save(room: Room) {
    const json = JSON.stringify(room);
    const next = this.chain
      .catch(() => {})
      .then(async () => {
        const tmp = path.join(this.cfg.dataDir, 'room.json.tmp');
        const handle = await open(tmp, 'w');
        try {
          await handle.writeFile(json);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(tmp, path.join(this.cfg.dataDir, 'room.json'));
      });
    this.chain = next;
    return next;
  }
  async validateImage(buffer: Buffer, kind: 'map' | 'token') {
    const c = this.cfg.caps;
    const maxBytes = kind === 'map' ? c.mapBytes : c.tokenBytes,
      edge = kind === 'map' ? c.mapEdge : c.tokenEdge,
      pixels = kind === 'map' ? c.mapPixels : c.tokenEdge ** 2;
    if (buffer.length > maxBytes) throw Error('图片文件超过上限');
    const input = sharp(buffer, { limitInputPixels: pixels, failOn: 'warning' });
    const m = await input.metadata();
    if (
      !['png', 'jpeg', 'webp'].includes(m.format ?? '') ||
      (m.pages ?? 1) > 1 ||
      !m.width ||
      !m.height ||
      m.width > edge ||
      m.height > edge ||
      m.width * m.height > pixels
    )
      throw Error('图片格式、动画或尺寸不符合限制');
    const { data, info } = await input
      .rotate()
      .webp({ lossless: true })
      .toBuffer({ resolveWithObject: true });
    // Re-encoded assets must themselves satisfy upload/restore limits.
    const output =
      data.length <= maxBytes ? data : await sharp(data).webp({ quality: 85 }).toBuffer();
    if (output.length > maxBytes) throw Error('图片转码后仍超出文件限制');
    return { data: output, width: info.width, height: info.height };
  }
  async put(buffer: Buffer, kind: 'map' | 'token') {
    const image = await this.validateImage(buffer, kind);
    const id = createHash('sha256').update(image.data).digest('hex') + '.webp';
    await writeFile(path.join(this.assetDir, id), image.data);
    return { asset: id, width: image.width, height: image.height };
  }
  refs(room: Room) {
    return new Set([
      ...(room.map ? [room.map.asset] : []),
      ...room.tokens.flatMap((t) => (t.asset ? [t.asset] : [])),
    ]);
  }
  async has(id: string) {
    assetId.parse(id);
    await readFile(path.join(this.assetDir, id));
  }
  async collect(room: Room) {
    const refs = this.refs(room);
    for (const name of await readdir(this.assetDir))
      if (
        assetId.safeParse(name).success &&
        !refs.has(name) &&
        Date.now() - (await stat(path.join(this.assetDir, name))).mtimeMs > 3600000
      )
        await unlink(path.join(this.assetDir, name)).catch(() => {});
  }
  async backup(room: Room) {
    const zip = new AdmZip();
    zip.addFile('room.json', Buffer.from(JSON.stringify(room)));
    for (const id of this.refs(room))
      zip.addFile('assets/' + id, await readFile(path.join(this.assetDir, id)));
    return zip.toBuffer();
  }
  async prepareRestore(buffer: Buffer) {
    const budget = this.cfg.caps.mapBytes + 255 * this.cfg.caps.tokenBytes + 8 * 1024 * 1024;
    if (buffer.length > budget) throw Error('备份超过大小上限');
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries();
    if (entries.length > 257) throw Error('备份文件数量异常');
    let total = 0;
    const files = new Map<string, Buffer>();
    for (const entry of entries) {
      if (
        entry.isDirectory ||
        !/^(room\.json|assets\/[a-f0-9]{64}\.webp)$/.test(entry.entryName) ||
        files.has(entry.entryName)
      )
        throw Error('备份路径或条目无效');
      const data = entry.getData();
      const limit =
        entry.entryName === 'room.json'
          ? 8 * 1024 * 1024
          : Math.max(this.cfg.caps.mapBytes, this.cfg.caps.tokenBytes);
      // The ZIP header size is attacker-controlled; verify the actual bytes too.
      if (data.length !== entry.header.size) throw Error('备份条目大小不一致');
      total += data.length;
      if (total > budget || data.length > limit) throw Error('备份展开大小超限');
      files.set(entry.entryName, data);
    }
    const room = parseRoom(JSON.parse(files.get('room.json')?.toString('utf8') ?? 'null'));
    for (const id of this.refs(room)) {
      const data = files.get('assets/' + id);
      if (!data || createHash('sha256').update(data).digest('hex') + '.webp' !== id)
        throw Error('图片缺失或校验失败');
      if (room.map?.asset === id) {
        const m = await this.validateImage(data, 'map');
        if (m.width !== room.map.width || m.height !== room.map.height)
          throw Error('地图尺寸不一致');
      }
      if (room.tokens.some((t) => t.asset === id)) await this.validateImage(data, 'token');
    }
    // All validation completes before any asset or room is committed.
    return {
      room,
      commitAssets: async () => {
        for (const id of this.refs(room))
          await writeFile(path.join(this.assetDir, id), files.get('assets/' + id)!);
      },
    };
  }
}
