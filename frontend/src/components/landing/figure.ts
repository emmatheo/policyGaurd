/**
 * Geometry for the stippled human figure.
 *
 * The figure is authored as vector geometry rather than loaded from an image so the
 * page stays self-contained: no external asset request, no resolution ceiling, and the
 * particle field can be regenerated at any density or canvas size.
 *
 * Everything below is expressed in a fixed 560 x 620 design space. The renderer scales
 * that to the canvas, so these numbers never need to change with the viewport.
 */

export const FIGURE_WIDTH = 560;
export const FIGURE_HEIGHT = 620;

/**
 * Head, neck and torso as one closed outline — a seated profile facing right, back
 * rounded forward. Drawn as a single filled path so the interior is solid before the
 * sampler carves it back into dots.
 */
const BODY_OUTLINE =
  "M 168 30 " +
  "C 196 30, 218 48, 224 76 " + // skull, front
  "C 229 98, 226 116, 218 130 " + // brow into the face
  "C 211 142, 200 150, 188 156 " + // cheek to chin
  "C 180 160, 176 168, 177 178 " + // chin into the throat
  "C 178 190, 184 200, 196 208 " + // throat to collarbone
  "C 218 222, 236 242, 246 268 " + // front of the shoulder
  "C 253 292, 255 320, 253 348 " + // chest
  "C 250 392, 245 438, 238 480 " + // front of the torso, drawing in at the waist
  "C 233 518, 227 552, 223 580 " +
  "L 112 580 " + // the base, where the figure dissolves
  "C 106 548, 100 514, 99 478 " +
  "C 98 432, 103 386, 112 344 " + // lower back
  "C 121 302, 132 266, 138 236 " + // the hunch across the upper back
  "C 142 214, 140 196, 133 180 " +
  "C 123 158, 116 134, 117 108 " + // nape into the back of the skull
  "C 119 66, 140 30, 168 30 Z";

/** A limb segment: a spline swept with a radius that tapers from start to end. */
interface Tube {
  points: [number, number][];
  startRadius: number;
  endRadius: number;
}

/**
 * The extended arm and hand.
 *
 * Limbs are swept tubes rather than outlines because a tapering radius along a spline
 * gives a natural shoulder-to-wrist falloff that would be tedious and brittle to
 * author as a closed bezier.
 */
const TUBES: Tube[] = [
  // Upper arm and forearm, shoulder through elbow to wrist. The taper does most of
  // the anatomical work here — a constant-width tube reads as a pipe.
  {
    points: [
      [215, 228],
      [268, 262],
      [325, 300],
      [382, 332],
      [430, 352],
    ],
    startRadius: 42,
    endRadius: 15,
  },
  // Palm.
  {
    points: [
      [430, 352],
      [455, 362],
      [472, 368],
    ],
    startRadius: 15,
    endRadius: 12,
  },
  // Index finger, extended — the gesture the whole pose points at.
  {
    points: [
      [470, 366],
      [494, 372],
      [516, 376],
    ],
    startRadius: 8,
    endRadius: 4,
  },
  // Folded fingers, tucked under the palm.
  {
    points: [
      [464, 376],
      [482, 382],
      [496, 384],
    ],
    startRadius: 7,
    endRadius: 4,
  },
  // Thumb.
  {
    points: [
      [450, 348],
      [468, 350],
      [480, 356],
    ],
    startRadius: 6,
    endRadius: 4,
  },
];

/** An ear, added as a small detail so the head reads as a profile at low density. */
const EAR: [number, number, number] = [150, 112, 12];

/**
 * Paints the solid figure into a 2D context sized to the design space.
 *
 * The result is a filled silhouette. Turning it into the stippled look is the
 * sampler's job — see buildParticles.
 */
export function drawFigure(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = "#000";

  ctx.fill(new Path2D(BODY_OUTLINE));

  for (const tube of TUBES) {
    sweepTube(ctx, tube);
  }

  ctx.beginPath();
  ctx.arc(EAR[0], EAR[1], EAR[2], 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Sweeps a circle of interpolated radius along a Catmull-Rom spline through the
 * given points, producing a smoothly tapering limb.
 */
function sweepTube(ctx: CanvasRenderingContext2D, tube: Tube): void {
  const { points, startRadius, endRadius } = tube;
  // Enough steps that consecutive circles overlap rather than beading.
  const steps = 220;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const [x, y] = splineAt(points, t);
    const radius = startRadius + (endRadius - startRadius) * t;

    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Catmull-Rom interpolation across the whole point list, with the end points
 * duplicated so the curve starts and ends exactly where it is told to.
 */
function splineAt(points: [number, number][], t: number): [number, number] {
  if (points.length === 1) return points[0];

  const segments = points.length - 1;
  const scaled = Math.min(t * segments, segments - 0.000001);
  const index = Math.floor(scaled);
  const local = scaled - index;

  const p0 = points[Math.max(0, index - 1)];
  const p1 = points[index];
  const p2 = points[Math.min(points.length - 1, index + 1)];
  const p3 = points[Math.min(points.length - 1, index + 2)];

  return [
    catmullRom(p0[0], p1[0], p2[0], p3[0], local),
    catmullRom(p0[1], p1[1], p2[1], p3[1], local),
  ];
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}
