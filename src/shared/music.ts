import { z } from 'zod';
export const audioId = z.string().regex(/^[a-f0-9]{64}\.mp3$/);
export const trackSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().max(1024),
    asset: audioId,
    duration: z.number().finite().positive(),
  })
  .strict();
export const librarySchema = z
  .object({ tracks: z.array(trackSchema) })
  .strict()
  .refine((s) => new Set(s.tracks.map((t) => t.id)).size === s.tracks.length, '曲目 ID 重复');
export type Track = z.infer<typeof trackSchema>;
export interface Playback {
  trackId: string | null;
  pushId: string | null;
  status: 'playing' | 'paused' | 'stopped';
  position: number;
  updatedAt: number;
}
export interface MusicSnapshot {
  tracks: Track[];
  playback: Playback;
  serverTime: number;
}
export function playbackPosition(playback: Playback, now: number, duration: number) {
  return Math.min(
    duration,
    Math.max(
      0,
      playback.position + (playback.status === 'playing' ? (now - playback.updatedAt) / 1000 : 0),
    ),
  );
}
