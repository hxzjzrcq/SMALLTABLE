import type { Locale } from '@dndroll/core';
import { t } from '../i18n';

/** 手绘风格 SVG d6 骰面。value 1–6；dropped 表示被舍弃的骰。 */
export function DieFace({
  value,
  locale,
  dropped = false,
  size = 34,
}: {
  value: number;
  locale: Locale;
  dropped?: boolean;
  size?: number;
}) {
  const pip = (cx: number, cy: number) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={7.5} />;
  const P: Record<number, [number, number][]> = {
    1: [[50, 50]],
    2: [
      [28, 28],
      [72, 72],
    ],
    3: [
      [26, 26],
      [50, 50],
      [74, 74],
    ],
    4: [
      [28, 28],
      [72, 28],
      [28, 72],
      [72, 72],
    ],
    5: [
      [26, 26],
      [74, 26],
      [50, 50],
      [26, 74],
      [74, 74],
    ],
    6: [
      [28, 26],
      [72, 26],
      [28, 50],
      [72, 50],
      [28, 74],
      [72, 74],
    ],
  };
  return (
    <svg
      className={`die${dropped ? ' die-dropped' : ''}`}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={dropped ? `d6 ${value} (${t('dropped', locale)})` : `d6 ${value}`}
    >
      <rect className="die-body" x={4} y={4} width={92} height={92} rx={18} />
      <g className="die-pips">{(P[value] ?? []).map(([x, y]) => pip(x, y))}</g>
      {dropped && <line className="die-slash" x1={16} y1={84} x2={84} y2={16} />}
    </svg>
  );
}
