export type Point = { x: number; y: number };
export type Camera = Point & { scale: number };
export const clampScale = (n: number) => Math.max(0.03, Math.min(8, n));
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
