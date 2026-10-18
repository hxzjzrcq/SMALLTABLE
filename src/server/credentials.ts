import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { open, readFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { lockDataDirectory } from './instance-lock.js';
import type { PasswordChange } from '../shared/passwords.js';
const derive = promisify(scrypt);
const hashSchema = z
  .object({ salt: z.string().regex(/^[a-f0-9]{32}$/), hash: z.string().regex(/^[a-f0-9]{64}$/) })
  .strict();
const schema = z.object({ version: z.literal(1), room: hashSchema, dm: hashSchema }).strict();
type Hash = z.infer<typeof hashSchema>;
type Credentials = z.infer<typeof schema>;
const blocked = new Set<string>(
  JSON.parse(await readFile(new URL('./weak-passwords.json', import.meta.url), 'utf8')),
);
export function validatePassword(value: string) {
  if ([...value].length < 8 || [...value].length > 128 || /[\s\p{C}]/u.test(value))
    throw Error('密码须为 8–128 个字符，不能含空白或控制字符');
  const classes = [/[A-Z]/, /[a-z]/, /[0-9]/, /[\p{P}\p{S}]/u].filter((r) => r.test(value)).length;
  if (classes < 2) throw Error('密码须包含大写字母、小写字母、数字、特殊符号中的至少两类');
  if (blocked.has(value.toLowerCase())) throw Error('密码过于常见，请换一个密码');
}
async function hash(password: string): Promise<Hash> {
  const salt = randomBytes(16).toString('hex');
  return {
    salt,
    hash: ((await derive(password, Buffer.from(salt, 'hex'), 32)) as Buffer).toString('hex'),
  };
}
async function matches(record: Hash, candidate: unknown) {
  return (
    typeof candidate === 'string' &&
    candidate.length <= 1024 &&
    timingSafeEqual(
      Buffer.from(record.hash, 'hex'),
      (await derive(candidate, Buffer.from(record.salt, 'hex'), 32)) as Buffer,
    )
  );
}
export class CredentialStore {
  private constructor(
    private dir: string,
    private value: Credentials,
    readonly close: () => Promise<void>,
  ) {}
  static async open(dir: string, initial: { roomPassword?: string; dmPassword?: string }) {
    const release = await lockDataDirectory(dir);
    try {
      let value: Credentials;
      try {
        value = schema.parse(
          JSON.parse(await readFile(path.join(dir, 'credentials.json'), 'utf8')),
        );
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
          throw Error('凭证文件损坏，拒绝自动覆盖；请停止服务后执行密码重置', { cause: e });
        if (!initial.roomPassword || !initial.dmPassword)
          throw Error('首次启动请在 .env 设置 ROOM_PASSWORD 和 DM_PASSWORD');
        value = await CredentialStore.prepare(initial.roomPassword, initial.dmPassword);
        await CredentialStore.write(dir, value);
      }
      return new CredentialStore(dir, value, release);
    } catch (e) {
      await release();
      throw e;
    }
  }
  private static async prepare(room: string, dm: string) {
    validatePassword(room);
    validatePassword(dm);
    if (room === dm) throw Error('房间口令与 DM 密码不能相同');
    return { version: 1 as const, room: await hash(room), dm: await hash(dm) };
  }
  private static async write(dir: string, value: Credentials) {
    const tmp = path.join(dir, 'credentials.json.tmp');
    const handle = await open(tmp, 'w', 0o600);
    try {
      await handle.writeFile(JSON.stringify(value));
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(tmp, path.join(dir, 'credentials.json'));
    } finally {
      await unlink(tmp).catch((e: NodeJS.ErrnoException) => {
        if (e.code !== 'ENOENT') throw e;
      });
    }
  }
  roomMatches = (candidate: unknown) => matches(this.value.room, candidate);
  dmMatches = (candidate: unknown) => matches(this.value.dm, candidate);
  async change(input: PasswordChange) {
    if (!(await this.dmMatches(input.currentDMPassword))) throw Error('当前 DM 密码错误');
    const { roomPassword: room, dmPassword: dm } = input;
    if (room !== undefined) validatePassword(room);
    if (dm !== undefined) validatePassword(dm);
    if (room !== undefined && (await this.roomMatches(room)))
      throw Error('新房间口令不能与当前相同');
    if (dm !== undefined && (await this.dmMatches(dm))) throw Error('新 DM 密码不能与当前相同');
    if (
      room !== undefined && dm !== undefined
        ? room === dm
        : room !== undefined
          ? await this.dmMatches(room)
          : dm !== undefined && (await this.roomMatches(dm))
    )
      throw Error('房间口令与 DM 密码不能相同');
    const next = {
      ...this.value,
      room: room === undefined ? this.value.room : await hash(room),
      dm: dm === undefined ? this.value.dm : await hash(dm),
    };
    await CredentialStore.write(this.dir, next);
    this.value = next;
  }
  static async reset(dir: string, room: string, dm: string) {
    const release = await lockDataDirectory(dir);
    try {
      await CredentialStore.write(dir, await CredentialStore.prepare(room, dm));
    } finally {
      await release();
    }
  }
}
