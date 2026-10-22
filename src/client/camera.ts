import type { View } from '../shared/model';
export type Point = { x: number; y: number };
export type Camera = Point & { scale: number };
export const clampScale = (n: number) => Math.max(0.0001, Math.min(8, n));
export function zoomCamera(camera: Camera, screen: Point, factor: number): Camera {
  const scale = clampScale(camera.scale * factor);
  return {
    scale,
    x: camera.x + screen.x / camera.scale - screen.x / scale,
    y: camera.y + screen.y / camera.scale - screen.y / scale,
  };
}
export function pinchCamera(
  start: Camera,
  anchor: Point,
  initialDistance: number,
  distance: number,
  midpoint: Point,
): Camera {
  const scale = clampScale((start.scale * distance) / Math.max(1, initialDistance));
  return { scale, x: anchor.x - midpoint.x / scale, y: anchor.y - midpoint.y / scale };
}

/** Full visual bounds include rotated square/image tokens; reserve screen pixels for strokes. */
export function fitRoomCamera(room: View, width: number, height: number): Camera {
  const map = room.maps.find((m) => m.id === room.currentMapId);
  const points = [
    { x: 0, y: 0 },
    { x: map ? (map.width * map.scale) / 100 : 640, y: map ? (map.height * map.scale) / 100 : 480 },
    ...room.drawings.flatMap((d) => [
      { x: d.x1, y: d.y1 },
      { x: d.x2, y: d.y2 },
    ]),
    ...room.tokens.flatMap((t) => {
      const half = (t.size * room.grid.cell) / 2,
        radians = (t.angle * Math.PI) / 180;
      const r =
        t.asset || t.shape === 'square'
          ? half * (Math.abs(Math.cos(radians)) + Math.abs(Math.sin(radians)))
          : half;
      return [
        { x: t.x - r, y: t.y - r },
        { x: t.x + r, y: t.y + r },
      ];
    }),
  ];
  const minX = Math.min(...points.map((p) => p.x)),
    minY = Math.min(...points.map((p) => p.y));
  const maxX = Math.max(...points.map((p) => p.x)),
    maxY = Math.max(...points.map((p) => p.y));
  const padding = 16;
  const scale = clampScale(
    Math.min(
      Math.max(1, width - padding * 2) / Math.max(1, maxX - minX),
      Math.max(1, height - padding * 2) / Math.max(1, maxY - minY),
    ),
  );
  return { x: minX - padding / scale, y: minY - padding / scale, scale };
}
