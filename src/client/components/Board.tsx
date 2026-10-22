import { useEffect, useRef, useState } from 'react';
import { WORLD_LIMIT, measure, type Drawing, type View } from '../../shared/model';
import type { SmalltableClient } from '../controller';
import {
  fitRoomCamera,
  clampScale,
  zoomCamera,
  pinchCamera,
  type Point,
  type Camera,
} from '../camera';
export function Board({
  room,
  selected,
  onSelect,
  actions,
  tool,
  drawColor = '#d33b32',
  fitSignal,
  epoch,
  connected,
  maxDrawings,
}: {
  room: View;
  selected: readonly string[];
  onSelect: (id: string | null, additive?: boolean) => void;
  actions: SmalltableClient;
  tool: 'move' | 'measure' | 'draw';
  drawColor?: Drawing['color'];
  fitSignal: number;
  epoch: number;
  connected: boolean;
  maxDrawings?: number;
}) {
  const selection = new Set(selected);
  const map = room.maps.find((m) => m.id === room.currentMapId);
  const svg = useRef<SVGSVGElement>(null),
    host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const [camera, setCamera] = useState<Camera>(() => {
    try {
      const c = JSON.parse(
        localStorage.getItem('smalltable.camera') ??
          localStorage.getItem('tabletop.camera') ??
          'null',
      );
      if (
        c &&
        Number.isFinite(c.x) &&
        Number.isFinite(c.y) &&
        Number.isFinite(c.scale) &&
        c.scale === clampScale(c.scale)
      )
        return c;
    } catch {}
    return { x: -100, y: -100, scale: 1 };
  });
  const [selectedDrawing, setSelectedDrawing] = useState<string | null>(null);
  const touches = useRef(new Map<number, Point>());
  const pinch = useRef<{ camera: Camera; anchor: Point; distance: number } | null>(null);
  const fitted = useRef(false);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const [preview, setPreview] = useState<{ id: string; x: number; y: number } | null>(null),
    [line, setLine] = useState<{ a: Point; b: Point } | null>(null);
  const drag = useRef<{
    kind: 'token' | 'pan' | 'measure' | 'draw';
    id?: string;
    start: Point;
    origin: Point;
    last: Point;
    sent: number;
    epoch: number;
  } | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(host.current!);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        localStorage.setItem('smalltable.camera', JSON.stringify(camera));
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [camera]);
  useEffect(() => {
    drag.current = null;
    touches.current.clear();
    pinch.current = null;
    setPreview(null);
    setLine(null);
    setSelectedDrawing(null);
  }, [epoch, connected, tool]);
  useEffect(() => {
    if (!fitted.current) {
      fitted.current = true;
      return;
    }
    setCamera(fitRoomCamera(room, size.width, size.height));
    // Fit is an explicit user action; ordinary snapshots must not reset the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSignal]);
  function point(e: { clientX: number; clientY: number }) {
    const box = svg.current!.getBoundingClientRect(),
      c = cameraRef.current;
    return { x: (e.clientX - box.left) / c.scale + c.x, y: (e.clientY - box.top) / c.scale + c.y };
  }
  function start(e: React.PointerEvent, id?: string) {
    if (e.button !== 0 && e.button !== 1 && e.button !== 2) return;
    e.preventDefault();
    svg.current?.focus({ preventScroll: true });
    if (e.button === 0 && tool === 'move' && e.shiftKey) {
      onSelect(id ?? null, true);
      drag.current = null;
      setPreview(null);
      setLine(null);
      setSelectedDrawing(null);
      return;
    }
    svg.current?.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.current.size >= 2) {
        const d = drag.current;
        if (d?.kind === 'token' && d.epoch === epoch && connected)
          actions.move(d.id!, d.last.x, d.last.y, true);
        drag.current = null;
        setPreview(null);
        setLine(null);
        const [a, b] = [...touches.current.values()],
          mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
        pinch.current = {
          camera: { ...cameraRef.current },
          anchor: point(mid),
          distance: Math.hypot(a.x - b.x, a.y - b.y),
        };
        return;
      }
    }
    const p = point(e);
    setSelectedDrawing(null);
    const t = room.tokens.find((t) => t.id === id);
    if (e.button !== 0 || (tool === 'move' && !t)) {
      drag.current = {
        kind: 'pan',
        start: { x: e.clientX, y: e.clientY },
        origin: { x: camera.x, y: camera.y },
        last: p,
        sent: 0,
        epoch,
      };
      if (e.button === 0) onSelect(null);
    } else if (tool === 'measure' || (tool === 'draw' && connected)) {
      if (tool === 'draw' && (Math.abs(p.x) > WORLD_LIMIT || Math.abs(p.y) > WORLD_LIMIT)) return;
      drag.current = { kind: tool, start: p, origin: p, last: p, sent: 0, epoch };
      setLine({ a: p, b: p });
    } else if (t && connected) {
      onSelect(t.id);
      drag.current = {
        kind: 'token',
        id: t.id,
        start: p,
        origin: { x: t.x, y: t.y },
        last: { x: t.x, y: t.y },
        sent: 0,
        epoch,
      };
      setPreview({ id: t.id, x: t.x, y: t.y });
    }
  }
  function moving(e: React.PointerEvent) {
    if (touches.current.has(e.pointerId))
      touches.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch.current && touches.current.size >= 2) {
      const [a, b] = [...touches.current.values()],
        box = svg.current!.getBoundingClientRect(),
        g = pinch.current;
      setCamera(
        pinchCamera(g.camera, g.anchor, g.distance, Math.hypot(a.x - b.x, a.y - b.y), {
          x: (a.x + b.x) / 2 - box.left,
          y: (a.y + b.y) / 2 - box.top,
        }),
      );
      return;
    }
    const d = drag.current;
    if (!d) return;
    const p = point(e);
    if (d.kind === 'pan') {
      setCamera((c) => ({
        ...c,
        x: d.origin.x - (e.clientX - d.start.x) / c.scale,
        y: d.origin.y - (e.clientY - d.start.y) / c.scale,
      }));
      return;
    }
    if (d.kind === 'measure' || d.kind === 'draw') {
      const end =
        d.kind === 'draw'
          ? {
              x: Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, p.x)),
              y: Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, p.y)),
            }
          : p;
      d.last = end;
      setLine({ a: d.start, b: end });
      return;
    }
    const x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, d.origin.x + p.x - d.start.x)),
      y = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, d.origin.y + p.y - d.start.y));
    d.last = { x, y };
    setPreview({ id: d.id!, x, y });
    if (Date.now() - d.sent >= 100) {
      actions.move(d.id!, x, y, false);
      d.sent = Date.now();
    }
  }
  function end(e: React.PointerEvent) {
    touches.current.delete(e.pointerId);
    if (pinch.current) {
      if (touches.current.size < 2) pinch.current = null;
      drag.current = null;
      setPreview(null);
      setLine(null);
      return;
    }
    const d = drag.current;
    if (
      e.type !== 'pointercancel' &&
      d?.kind === 'draw' &&
      d.epoch === epoch &&
      connected &&
      maxDrawings !== undefined &&
      room.drawings.length < maxDrawings
    ) {
      const p = d.last;
      if (Math.hypot(p.x - d.start.x, p.y - d.start.y) * cameraRef.current.scale >= 3)
        actions.addDrawing({
          id: crypto.randomUUID(),
          x1: d.start.x,
          y1: d.start.y,
          x2: p.x,
          y2: p.y,
          color: drawColor,
        });
    }
    if (d?.kind === 'token' && d.epoch === epoch && connected)
      actions.move(d.id!, d.last.x, d.last.y, true);
    drag.current = null;
    setPreview(null);
    setLine(null);
  }
  // A native non-passive listener allows anchored wheel zoom without scrolling the page.
  useEffect(() => {
    const node = svg.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = point(e),
        c = cameraRef.current,
        box = node.getBoundingClientRect(),
        scale = clampScale(c.scale * Math.exp(-e.deltaY * 0.001));
      setCamera({
        scale,
        x: p.x - (e.clientX - box.left) / scale,
        y: p.y - (e.clientY - box.top) / scale,
      });
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  const sorted = [...room.tokens].sort(
    (a, b) => (selection.has(a.id) ? 1 : 0) - (selection.has(b.id) ? 1 : 0),
  );
  const selectedToken =
    selected.length === 1 ? room.tokens.find((t) => t.id === selected[0]) : undefined;
  const selectedPosition = preview?.id === selectedToken?.id ? preview : selectedToken;
  return (
    <div ref={host} className={`board ${tool}`}>
      <div className="board-zoom" aria-label="相机缩放">
        <button
          aria-label="放大视图"
          onClick={() =>
            setCamera((c) => zoomCamera(c, { x: size.width / 2, y: size.height / 2 }, 1.25))
          }
        >
          ＋
        </button>
        <button
          aria-label="缩小视图"
          onClick={() =>
            setCamera((c) => zoomCamera(c, { x: size.width / 2, y: size.height / 2 }, 0.8))
          }
        >
          −
        </button>
      </div>
      {selectedDrawing && room.drawings.some((d) => d.id === selectedDrawing) && (
        <button
          className="drawing-delete"
          disabled={!connected}
          onClick={() => {
            actions.deleteDrawing(selectedDrawing);
            setSelectedDrawing(null);
          }}
        >
          删除选中线条
        </button>
      )}
      {tool === 'move' && selectedToken && selectedPosition && (
        <button
          className="token-rotate"
          aria-label="顺时针旋转棋子 45°"
          title="顺时针旋转 45°"
          disabled={!connected}
          style={{
            left: (selectedPosition.x - camera.x) * camera.scale,
            top:
              (selectedPosition.y -
                camera.y -
                ((selectedToken.size * room.grid.cell) / 2) *
                  (selectedToken.shape === 'square'
                    ? Math.abs(Math.cos((selectedToken.angle * Math.PI) / 180)) +
                      Math.abs(Math.sin((selectedToken.angle * Math.PI) / 180))
                    : 1)) *
                camera.scale -
              6,
          }}
          onClick={() => actions.rotate(selectedToken, 45)}
        >
          ↻
        </button>
      )}
      <svg
        ref={svg}
        tabIndex={0}
        width="100%"
        height="100%"
        viewBox={`${camera.x} ${camera.y} ${size.width / camera.scale} ${size.height / camera.scale}`}
        onPointerDown={(e) => start(e)}
        onPointerMove={moving}
        onPointerUp={end}
        onPointerCancel={end}
        onContextMenu={(e) => e.preventDefault()}
        aria-label="共享桌面，拖动空白平移，滚轮或双指缩放"
      >
        <defs>
          <pattern
            id="grid"
            width={room.grid.cell}
            height={room.grid.cell}
            x={room.grid.x}
            y={room.grid.y}
            patternUnits="userSpaceOnUse"
          >
            <path
              d={`M ${room.grid.cell} 0 L 0 0 0 ${room.grid.cell}`}
              fill="none"
              stroke="#536471"
              strokeWidth={1 / camera.scale}
              opacity=".45"
            />
          </pattern>
        </defs>
        {map ? (
          <image
            href={`/media/${map.asset}`}
            x="0"
            y="0"
            width={(map.width * map.scale) / 100}
            height={(map.height * map.scale) / 100}
          />
        ) : (
          <rect x="0" y="0" width="640" height="480" fill="#e5e8e9" />
        )}
        {room.grid.visible && (
          <rect
            x={camera.x}
            y={camera.y}
            width={size.width / camera.scale}
            height={size.height / camera.scale}
            fill="url(#grid)"
            pointerEvents="none"
          />
        )}
        {room.drawings.map((d) => (
          <g key={d.id} className="board-drawing">
            <line
              x1={d.x1}
              y1={d.y1}
              x2={d.x2}
              y2={d.y2}
              stroke={selectedDrawing === d.id ? '#ffb000' : d.color}
              strokeWidth={(selectedDrawing === d.id ? 5 : 3) / camera.scale}
              pointerEvents="none"
            />
            <line
              x1={d.x1}
              y1={d.y1}
              x2={d.x2}
              y2={d.y2}
              stroke="transparent"
              strokeWidth={16 / camera.scale}
              pointerEvents={tool === 'move' ? 'stroke' : 'none'}
              role="button"
              aria-label="选择线条"
              onPointerDown={(e) => {
                if (e.button !== 0 || tool !== 'move') return;
                e.stopPropagation();
                e.preventDefault();
                onSelect(null);
                setSelectedDrawing(d.id);
              }}
            />
          </g>
        ))}
        {sorted.map((t) => {
          const p = preview?.id === t.id ? preview : t,
            s = t.size * room.grid.cell;
          return (
            <g
              key={t.id}
              transform={`translate(${p.x} ${p.y}) rotate(${t.angle})`}
              onPointerDown={(e) => {
                e.stopPropagation();
                start(e, t.id);
              }}
              className="board-token"
              aria-pressed={selection.has(t.id)}
              data-token-id={t.id}
              role="button"
              aria-label={t.name || t.label || '棋子'}
            >
              <title>{t.name || t.label || '棋子'}</title>
              {t.asset ? (
                <rect
                  x={-s / 2}
                  y={-s / 2}
                  width={s}
                  height={s}
                  fill="transparent"
                  pointerEvents="all"
                />
              ) : t.shape === 'circle' ? (
                <circle
                  r={s / 2}
                  fill={t.color}
                  stroke={selection.has(t.id) ? '#ffb000' : '#27333f'}
                  strokeWidth={(selection.has(t.id) ? 3 : 1) / camera.scale}
                />
              ) : (
                <rect
                  x={-s / 2}
                  y={-s / 2}
                  width={s}
                  height={s}
                  rx={Math.min(3, s / 8)}
                  fill={t.color}
                  stroke={selection.has(t.id) ? '#ffb000' : '#27333f'}
                  strokeWidth={(selection.has(t.id) ? 3 : 1) / camera.scale}
                />
              )}
              {t.asset ? (
                <image
                  href={`/media/${t.asset}`}
                  x={-s / 2}
                  y={-s / 2}
                  width={s}
                  height={s}
                  preserveAspectRatio="xMidYMid meet"
                  pointerEvents="none"
                />
              ) : (
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={Math.max(1, s * 0.34)}
                  fill="#fff"
                  stroke="#000"
                  strokeWidth={s * 0.006}
                  paintOrder="stroke"
                  pointerEvents="none"
                >
                  {t.label}
                </text>
              )}
              {selection.has(t.id) && (
                <rect
                  x={-s / 2 - 3 / camera.scale}
                  y={-s / 2 - 3 / camera.scale}
                  width={s + 6 / camera.scale}
                  height={s + 6 / camera.scale}
                  fill="none"
                  stroke="#ffb000"
                  strokeWidth={1 / camera.scale}
                  pointerEvents="none"
                />
              )}
            </g>
          );
        })}
        {line && (
          <g pointerEvents="none">
            <line
              x1={line.a.x}
              y1={line.a.y}
              x2={line.b.x}
              y2={line.b.y}
              stroke={tool === 'draw' ? drawColor : '#b32217'}
              strokeWidth={2 / camera.scale}
            />
            {tool === 'measure' && (
              <text
                x={(line.a.x + line.b.x) / 2}
                y={(line.a.y + line.b.y) / 2 - 10 / camera.scale}
                fontSize={16 / camera.scale}
                textAnchor="middle"
                stroke="white"
                strokeWidth={4 / camera.scale}
                paintOrder="stroke"
                fill="#9b1a10"
              >
                {measure(line.a, line.b, room.grid.cell)} 格
              </text>
            )}
          </g>
        )}
      </svg>
      <div className="board-help">
        {tool === 'measure'
          ? '拖出测距线 · 仅自己可见'
          : tool === 'draw'
            ? '按下并拖动画直线 · 松开后同步 · 双指缩放'
            : '拖动棋子 · 拖空白平移 · 点击线条可删除'}
        　滚轮 / 双指缩放 · {Math.round(camera.scale * 100)}%
      </div>
    </div>
  );
}
