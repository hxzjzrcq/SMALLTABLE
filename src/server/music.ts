import { createHash, randomUUID } from 'node:crypto';
import { readFile, stat, mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
import {
  librarySchema,
  playbackPosition,
  type Track,
  type Playback,
  type MusicSnapshot,
} from '../shared/music.js';
import { inspectMp3 } from './mp3.js';
import type { Capabilities } from '../shared/limits.js';
export class Music {
  tracks: Track[] = [];
  readonly audioDir: string;
  private playback: Playback = {
    trackId: null,
    pushId: null,
    status: 'stopped',
    position: 0,
    updatedAt: Date.now(),
  };
  private timer?: ReturnType<typeof setTimeout>;
  constructor(
    private dataDir: string,
    private caps: Capabilities,
    private publish: () => void,
  ) {
    this.audioDir = path.join(dataDir, 'audio');
  }
  async load() {
    await mkdir(this.audioDir, { recursive: true });
    let raw: string;
    try {
      const file = path.join(this.dataDir, 'music.json');
      if ((await stat(file)).size > this.caps.maxMusic * 8192 + 1024)
        throw Error('音乐元数据超出大小限制');
      raw = await readFile(file, 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw e;
    }
    this.tracks = librarySchema.parse(JSON.parse(raw)).tracks;
    if (this.tracks.length > this.caps.maxMusic) throw Error('现有音乐数量超出配置');
    for (const track of this.tracks) {
      const file = path.join(this.audioDir, track.asset);
      if ((await stat(file)).size > this.caps.musicBytes) throw Error('现有音乐大小超出配置');
      const data = await readFile(file);
      if (createHash('sha256').update(data).digest('hex') + '.mp3' !== track.asset)
        throw Error('音乐哈希不一致');
      const { duration } = inspectMp3(data);
      if (Math.abs(duration - track.duration) > 0.001) throw Error('音乐时长不一致');
    }
  }
  async save(tracks: Track[]) {
    librarySchema.parse({ tracks });
    const file = path.join(this.dataDir, 'music.json');
    const h = await open(file + '.tmp', 'w');
    try {
      await h.writeFile(JSON.stringify({ tracks }));
      await h.sync();
    } finally {
      await h.close();
    }
    await rename(file + '.tmp', file);
    this.tracks = tracks;
  }
  snapshot(): MusicSnapshot {
    return { tracks: this.tracks, playback: { ...this.playback }, serverTime: Date.now() };
  }
  control(action: 'play' | 'pause' | 'stop', id?: string) {
    const now = Date.now(),
      p = this.playback;
    if (action === 'play') {
      const track = this.tracks.find((t) => t.id === id);
      if (!track) throw Error('曲目不存在');
      if (p.trackId !== id)
        this.playback = {
          trackId: id!,
          pushId: randomUUID(),
          status: 'playing',
          position: 0,
          updatedAt: now,
        };
      else
        this.playback = {
          ...p,
          status: 'playing',
          position: playbackPosition(p, now, track.duration),
          updatedAt: now,
        };
    } else {
      const track = this.tracks.find((t) => t.id === p.trackId);
      this.playback = {
        ...p,
        status: action === 'pause' ? 'paused' : 'stopped',
        position: action === 'stop' ? 0 : playbackPosition(p, now, track?.duration ?? 0),
        updatedAt: now,
      };
    }
    this.arm();
    this.publish();
  }
  removed(id: string) {
    if (this.playback.trackId === id) {
      clearTimeout(this.timer);
      this.playback = {
        trackId: null,
        pushId: null,
        status: 'stopped',
        position: 0,
        updatedAt: Date.now(),
      };
    }
  }
  private arm() {
    clearTimeout(this.timer);
    const t = this.tracks.find((t) => t.id === this.playback.trackId);
    if (!t || this.playback.status !== 'playing') return;
    // Node timers are limited to 2^31-1 ms; MP3 frame counts still bound practical duration.
    this.timer = setTimeout(
      () => this.control('stop'),
      Math.min(
        2147483647,
        Math.max(0, (t.duration - playbackPosition(this.playback, Date.now(), t.duration)) * 1000),
      ),
    );
    this.timer.unref();
  }
  close() {
    clearTimeout(this.timer);
  }
}
