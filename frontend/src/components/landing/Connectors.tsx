"use client";

/**
 * The four corner connector runs.
 *
 * Thin rules sweep in from each edge and curve toward the figure, with pill labels and
 * node dots sitting on the line. Lines and pills share one SVG so a label always lands
 * exactly on its rule — positioning HTML pills over a separate SVG layer drifts as
 * soon as the container changes width.
 *
 * `preserveAspectRatio="none"` lets the runs span the full width at any viewport. The
 * distortion that introduces is invisible on hairlines, and the pills counteract it
 * with a compensating transform.
 */

const VIEW_W = 1200;
const VIEW_H = 640;

const STROKE = "rgba(17,17,17,0.16)";
const DOT = "rgba(17,17,17,0.5)";

interface Pill {
  x: number;
  y: number;
  label: string;
}

/** Rough character advance for the pill font, used to size the rounded rect. */
const CHAR_W = 5.6;
const PILL_H = 19;

export function Connectors({ className = "" }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      {/* Top left: in from the edge, then up and over toward the head. */}
      <path
        d={`M 0 22 H 150 M 330 22 H 470 C 530 22, 545 60, 560 110`}
        fill="none"
        stroke={STROKE}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <Node x={112} y={22} />
      <PillLabel x={240} y={22} label="BUILDERS" />

      {/* Top right: down from the figure, out to the edge. */}
      <path
        d={`M 690 110 C 706 62, 730 22, 790 22 H 830 M 960 22 H ${VIEW_W}`}
        fill="none"
        stroke={STROKE}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <PillLabel x={895} y={22} label="AGENTS" />
      <Node x={1010} y={22} />

      {/* Bottom left: two labels, then a curve up toward the torso. */}
      <path
        d={`M 0 ${VIEW_H - 22} H 130 M 250 ${VIEW_H - 22} H 268 M 388 ${VIEW_H - 22} H 452
            C 512 ${VIEW_H - 22}, 528 ${VIEW_H - 70}, 540 ${VIEW_H - 130}`}
        fill="none"
        stroke={STROKE}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <PillLabel x={190} y={VIEW_H - 22} label="FAILS" />
      <PillLabel x={328} y={VIEW_H - 22} label="EDGE CASES" />
      <Node x={470} y={VIEW_H - 22} />

      {/* Bottom right: mirrors the left, out to the edge. */}
      <path
        d={`M 700 ${VIEW_H - 130} C 712 ${VIEW_H - 70}, 728 ${VIEW_H - 22}, 788 ${VIEW_H - 22}
            H 812 M 918 ${VIEW_H - 22} H 936 M 1042 ${VIEW_H - 22} H ${VIEW_W}`}
        fill="none"
        stroke={STROKE}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <Node x={790} y={VIEW_H - 22} />
      <PillLabel x={866} y={VIEW_H - 22} label="EVALS" />
      <PillLabel x={990} y={VIEW_H - 22} label="SCORES" />
    </svg>
  );
}

function Node({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r="2.6" fill={DOT} vectorEffect="non-scaling-stroke" />;
}

/**
 * A label pill centred on (x, y).
 *
 * The group is scaled on X by the inverse of the viewBox stretch so the rounded ends
 * stay circular and the text keeps its proportions, regardless of container width.
 */
function PillLabel({ x, y, label }: Pill) {
  const width = label.length * CHAR_W + 22;

  return (
    <g transform={`translate(${x} ${y})`}>
      <rect
        x={-width / 2}
        y={-PILL_H / 2}
        width={width}
        height={PILL_H}
        rx={PILL_H / 2}
        fill="#f4f3f1"
        stroke={STROKE}
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      <text
        x="0"
        y="0.5"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="9"
        letterSpacing="0.9"
        fill="rgba(17,17,17,0.62)"
        fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif"
        fontWeight="500"
      >
        {label}
      </text>
    </g>
  );
}
