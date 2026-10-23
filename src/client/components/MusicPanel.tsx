import { UploadStatus } from './UploadStatus';
import { useEffect, useRef, useState } from 'react';
import { playbackPosition, type MusicSnapshot } from '../../shared/music';
import type { Capabilities } from '../../shared/limits';
import type { SmalltableClient } from '../controller';
type Choice = 'accepted' | 'rejected';
// A fresh navigation (including a tab copied from an opener) starts as a new join.
// A reload keeps the tab-scoped choice; reconnects do not reload this module.
try {
  const nav = performance.getEntriesByType('navigation')[0] as
    PerformanceNavigationTiming | undefined;
  if (nav && nav.type !== 'reload') sessionStorage.removeItem('smalltable.music.choice');
} catch {}
function remembered(pushId: string | null) {
  try {
    const saved = JSON.parse(sessionStorage.getItem('smalltable.music.choice') ?? 'null');
    if (pushId && saved?.pushId === pushId && ['accepted', 'rejected'].includes(saved.choice))
      return saved.choice as Choice;
  } catch {}
  return null;
}
export function MusicPanel({
  music,
  consent,
  dm,
  connected,
  caps,
  actions,
}: {
  music?: MusicSnapshot;
  consent?: { pushId: string };
  dm: boolean;
  connected: boolean;
  caps: Capabilities | null;
  actions: SmalltableClient;
}) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const latest = useRef(music);
  latest.current = music;
  const offset = useRef(0);
  const pushId = music?.playback.pushId ?? null;
  const [decision, setDecision] = useState<{ pushId: string | null; choice: Choice | null }>({
    pushId: null,
    choice: null,
  });
  const choice = decision.pushId === pushId ? decision.choice : remembered(pushId);
  const [local, setLocal] = useState('未接受'),
    [message, setMessage] = useState('');
  const [volume, setVolume] = useState(0.5),
    [muted, setMuted] = useState(false),
    [busy, setBusy] = useState(false);
  const track = music?.tracks.find((t) => t.id === music.playback.trackId);
  function choose(value: Choice, id = pushId) {
    if (!id || id !== latest.current?.playback.pushId) return;
    setDecision({ pushId: id, choice: value });
    try {
      sessionStorage.setItem(
        'smalltable.music.choice',
        JSON.stringify({ pushId: id, choice: value }),
      );
    } catch {
      setMessage('无法保存本标签页选择，刷新后需要重新选择');
    }
  }
  async function synchronize(a: HTMLAudioElement) {
    const state = latest.current;
    if (!state || a.dataset.pushId !== state.playback.pushId || a.readyState < 1) return;
    const t = state.tracks.find((t) => t.id === state.playback.trackId);
    if (!t) return;
    const position = playbackPosition(state.playback, Date.now() - offset.current, t.duration);
    if (state.playback.status === 'stopped' || Math.abs(a.currentTime - position) > 0.75)
      a.currentTime = Math.min(position, a.duration || position);
    if (state.playback.status !== 'playing') {
      a.pause();
      setLocal(state.playback.status === 'paused' ? '暂停' : '停止');
      return;
    }
    try {
      await a.play();
      if (
        audio.current !== a ||
        latest.current?.playback.pushId !== a.dataset.pushId ||
        latest.current?.playback.status !== 'playing'
      ) {
        a.pause();
        return;
      }
      setLocal(a.paused ? '受浏览器阻止' : '播放中');
    } catch (e) {
      if (audio.current === a)
        setLocal((e as DOMException).name === 'NotAllowedError' ? '受浏览器阻止' : '加载失败');
    }
  }
  useEffect(() => {
    if (music) offset.current = Date.now() - music.serverTime;
  }, [music]);
  useEffect(() => {
    if (consent?.pushId && consent.pushId === pushId) choose('accepted', pushId);
  }, [consent]);
  // A source is assigned only after this tab accepts this push. Switching tears it down first.
  useEffect(() => {
    if (!connected || !track || !pushId || choice !== 'accepted') {
      setLocal(choice === 'rejected' ? '已拒绝' : '未接受');
      return;
    }
    const a = new Audio();
    a.dataset.pushId = pushId;
    audio.current = a;
    a.volume = volume;
    a.muted = muted;
    a.onloadedmetadata = () => void synchronize(a);
    a.onplaying = () => {
      if (audio.current === a) setLocal('播放中');
    };
    a.onerror = () => {
      if (audio.current === a) setLocal('加载失败');
    };
    a.onended = () => {
      if (audio.current === a) setLocal('停止');
    };
    setLocal('加载中');
    a.preload = 'metadata';
    a.src = `/audio/${track.asset}`;
    a.load();
    const timer = setInterval(() => {
      if (a.readyState >= 1 && !a.paused && latest.current?.playback.status === 'playing')
        void synchronize(a);
    }, 1000);
    return () => {
      clearInterval(timer);
      audio.current = null;
      a.onloadedmetadata = a.onplaying = a.onerror = a.onended = null;
      a.pause();
      a.removeAttribute('src');
      a.load();
    };
  }, [connected, pushId, track?.asset, choice]);
  useEffect(() => {
    if (audio.current) void synchronize(audio.current);
  }, [music?.playback.status, music?.playback.updatedAt]);
  useEffect(() => {
    if (audio.current) {
      audio.current.volume = volume;
      audio.current.muted = muted;
    }
  }, [volume, muted]);
  if (!music) return null;
  return (
    <section className="music-panel" aria-label="房间音乐">
      <div className="button-row">
        <strong>房间音乐</strong>
        <span>
          全桌：{{ playing: '播放', paused: '暂停', stopped: '停止' }[music.playback.status]} ·{' '}
          {track?.name ?? '无曲目'}
        </span>
        <span role="status">本地：{local}</span>
        {track && !choice && (
          <span className="music-choice" key={pushId}>
            <span>接受本次音乐推送？</span>
            <button disabled={!connected} onClick={() => choose('accepted')}>
              接受音乐
            </button>
            <button onClick={() => choose('rejected')}>拒绝音乐</button>
          </span>
        )}
        {track && choice === 'accepted' && (
          <>
            {(local === '受浏览器阻止' || local === '加载失败') && (
              <button
                onClick={() => {
                  if (audio.current) {
                    if (audio.current.error) audio.current.load();
                    void synchronize(audio.current);
                  }
                }}
              >
                点击播放
              </button>
            )}
            <button onClick={() => choose('rejected')}>拒绝本次音乐</button>
          </>
        )}
        <label>
          本地音量{' '}
          <input
            aria-label="本地音量"
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
          />
        </label>
        <label>
          <input type="checkbox" checked={muted} onChange={(e) => setMuted(e.target.checked)} />
          本地静音
        </label>
      </div>
      {dm && (
        <details>
          <summary>
            音乐管理 {music.tracks.length} / {caps?.maxMusic ?? '—'}
          </summary>
          <UploadStatus actions={actions} kind="music" />
          <label className="button">
            上传 MP3
            <input
              type="file"
              hidden
              accept=".mp3,audio/mpeg"
              disabled={busy || !connected || !caps || music.tracks.length >= caps.maxMusic}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f || !caps) return;
                if (f.size > caps.musicBytes) {
                  setMessage('音乐文件超过配置上限');
                  return;
                }
                setBusy(true);
                try {
                  await actions.uploadMusic(f);
                  setMessage('音乐已加入库');
                } catch (e) {
                  setMessage(String(e));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {music.tracks.map((t) => (
            <div className="button-row" key={t.id}>
              <span>
                {t.name} · {Math.round(t.duration)}秒
              </span>
              <button
                disabled={!connected}
                onClick={() => {
                  actions.send({ type: 'music.play', id: t.id });
                }}
              >
                播放
              </button>
              <button
                disabled={!connected}
                onClick={() => {
                  if (confirm(`删除曲目“${t.name}”？`))
                    actions.send({ type: 'music.delete', id: t.id });
                }}
              >
                删除曲目
              </button>
            </div>
          ))}
          <div className="button-row">
            <button
              disabled={!connected || !track}
              onClick={() => actions.send({ type: 'music.pause' })}
            >
              暂停全桌音乐
            </button>
            <button
              disabled={!connected || !track}
              onClick={() => actions.send({ type: 'music.stop' })}
            >
              停止全桌音乐
            </button>
          </div>
        </details>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
