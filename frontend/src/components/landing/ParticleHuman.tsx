"use client";

import { useEffect, useRef } from "react";

import { drawFigure, FIGURE_HEIGHT, FIGURE_WIDTH } from "./figure";

/**
 * The animated stipple figure.
 *
 * The silhouette is rasterised once to an offscreen mask, then sampled into a particle
 * field whose density follows distance-from-edge — dense along contours, sparse in the
 * interior, thinning to nothing at the base. That distribution is what makes a solid
 * shape read as pointillist rather than as a grey fill.
 *
 * Each particle then animates on three independent channels: a staggered assembly from
 * scattered start positions, a continuous low-amplitude drift, and a slow vertical
 * scan that briefly displaces and darkens the band it passes through.
 */

interface Particle {
  /** Resting position, in canvas pixels. */
  homeX: number;
  homeY: number;
  /** Where the particle assembles from. */
  fromX: number;
  fromY: number;
  /** Independent phases so no two particles drift in step. */
  phaseX: number;
  phaseY: number;
  /** Drift amplitude. Interior particles wander more than contour particles. */
  drift: number;
  /** Parallax depth, 0 (fixed) to 1 (most responsive to the pointer). */
  depth: number;
  size: number;
  alpha: number;
  /** Fraction of the assembly window this particle waits before moving. */
  delay: number;
}

/** Alpha is quantised into buckets so a frame costs a few fillStyle changes, not thousands. */
const ALPHA_BUCKETS = 7;
const ASSEMBLY_MS = 1900;
const SCAN_PERIOD_MS = 9000;

export function ParticleHuman({ className = "" }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let particles: Particle[] = [];
    let buckets: Particle[][] = [];
    let width = 0;
    let height = 0;
    let scale = 1;

    // Pointer parallax, held as a target the render loop eases toward so the figure
    // never snaps.
    const pointer = { x: 0, y: 0, currentX: 0, currentY: 0 };

    let startedAt = performance.now();
    let frame = 0;

    const rebuild = () => {
      const parent = canvas.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));

      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Fit the figure inside the box, leaving a little headroom.
      scale = Math.min(width / FIGURE_WIDTH, height / FIGURE_HEIGHT) * 0.95;

      particles = buildParticles(width, height, scale);
      buckets = bucketByAlpha(particles);
      startedAt = performance.now();
    };

    const render = (now: number) => {
      const elapsed = now - startedAt;
      ctx.clearRect(0, 0, width, height);

      // Ease the parallax toward the pointer.
      pointer.currentX += (pointer.x - pointer.currentX) * 0.055;
      pointer.currentY += (pointer.y - pointer.currentY) * 0.055;

      const t = elapsed / 1000;
      const scanY = reduceMotion
        ? -1
        : ((elapsed % SCAN_PERIOD_MS) / SCAN_PERIOD_MS) * (height * 1.35) - height * 0.18;

      for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b];
        if (bucket.length === 0) continue;

        // One fillStyle per bucket rather than per particle.
        const bucketAlpha = ((b + 1) / ALPHA_BUCKETS) * 0.95;
        ctx.fillStyle = `rgba(23, 23, 23, ${bucketAlpha.toFixed(3)})`;

        for (let i = 0; i < bucket.length; i++) {
          const p = bucket[i];

          let x = p.homeX;
          let y = p.homeY;

          if (!reduceMotion) {
            // Assembly: scattered start easing into place, staggered per particle.
            const span = 1 - p.delay;
            const local = clamp01((elapsed / ASSEMBLY_MS - p.delay) / span);
            if (local < 1) {
              const eased = easeOutCubic(local);
              x = p.fromX + (p.homeX - p.fromX) * eased;
              y = p.fromY + (p.homeY - p.fromY) * eased;
            }

            // Idle drift.
            x += Math.sin(t * 0.62 + p.phaseX) * p.drift;
            y += Math.cos(t * 0.48 + p.phaseY) * p.drift * 0.8;

            // Parallax, strongest on the particles marked as nearest.
            x += pointer.currentX * p.depth;
            y += pointer.currentY * p.depth;

            // The scan band: a soft falloff that nudges particles sideways as it passes.
            const distance = Math.abs(y - scanY);
            if (distance < 90) {
              const influence = 1 - distance / 90;
              x += influence * influence * 13;
            }
          }

          ctx.fillRect(x, y, p.size, p.size);
        }
      }

      frame = requestAnimationFrame(render);
    };

    const onPointerMove = (event: PointerEvent) => {
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width - 0.5) * 26;
      pointer.y = ((event.clientY - rect.top) / rect.height - 0.5) * 16;
    };

    const onPointerLeave = () => {
      pointer.x = 0;
      pointer.y = 0;
    };

    rebuild();
    frame = requestAnimationFrame(render);

    const observer = new ResizeObserver(rebuild);
    if (canvas.parentElement) observer.observe(canvas.parentElement);

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerleave", onPointerLeave);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerleave", onPointerLeave);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label="Animated particle illustration of a person leaning forward, reaching out a hand"
    />
  );
}

/**
 * Rasterises the figure and samples it into a particle field.
 *
 * Density is driven by an edge score: a point surrounded entirely by filled pixels is
 * deep inside the shape and rarely emits, while a point near the boundary almost
 * always does. A vertical fade thins the base so the figure dissolves rather than
 * ending on a hard edge.
 */
function buildParticles(width: number, height: number, scale: number): Particle[] {
  const maskWidth = FIGURE_WIDTH;
  const maskHeight = FIGURE_HEIGHT;

  const mask = document.createElement("canvas");
  mask.width = maskWidth;
  mask.height = maskHeight;

  const maskCtx = mask.getContext("2d", { willReadFrequently: true });
  if (!maskCtx) return [];

  drawFigure(maskCtx);

  const pixels = maskCtx.getImageData(0, 0, maskWidth, maskHeight).data;
  const filled = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= maskWidth || y >= maskHeight) return false;
    return pixels[(y * maskWidth + x) * 4 + 3] > 128;
  };

  // Centre the scaled figure in the canvas.
  const drawnWidth = maskWidth * scale;
  const drawnHeight = maskHeight * scale;
  const offsetX = (width - drawnWidth) / 2;
  const offsetY = (height - drawnHeight) / 2;

  const particles: Particle[] = [];
  // Step in mask space; smaller means denser. Tuned for roughly 7-9k particles.
  const step = 1.7;

  for (let y = 0; y < maskHeight; y += step) {
    for (let x = 0; x < maskWidth; x += step) {
      const px = Math.round(x);
      const py = Math.round(y);
      if (!filled(px, py)) continue;

      const edge = edgeScore(filled, px, py);

      // Contours are near-solid; the interior is sparse and grainy.
      let probability = 0.045 + edge * 0.62;

      // Dissolve toward the base.
      const vertical = y / maskHeight;
      if (vertical > 0.62) {
        probability *= Math.max(0, 1 - (vertical - 0.62) / 0.38) ** 1.5;
      }

      // Clumping, so the grain does not look like a uniform screen.
      probability *= 0.55 + hashNoise(px * 0.08, py * 0.08) * 0.95;

      if (Math.random() > probability) continue;

      const homeX = offsetX + x * scale;
      const homeY = offsetY + y * scale;

      // Particles assemble inward from a ring around their resting place.
      const angle = Math.random() * Math.PI * 2;
      const distance = 40 + Math.random() * 190;

      particles.push({
        homeX,
        homeY,
        fromX: homeX + Math.cos(angle) * distance,
        fromY: homeY + Math.sin(angle) * distance * 0.7,
        phaseX: Math.random() * Math.PI * 2,
        phaseY: Math.random() * Math.PI * 2,
        // Interior particles are freer to wander; contour particles hold the shape.
        drift: (1 - edge) * 2.6 + 0.5 + Math.random() * 0.9,
        depth: 0.35 + Math.random() * 0.65,
        size: edge > 0.55 ? 1.6 : Math.random() < 0.22 ? 1.6 : 1.1,
        alpha: Math.min(1, 0.3 + edge * 0.72 + Math.random() * 0.18),
        delay: Math.random() * 0.55,
      });
    }
  }

  return particles;
}

/**
 * Approximates how close a filled pixel is to the silhouette's edge by probing
 * outward in eight directions at three radii. Returns 0 deep inside, approaching 1 on
 * the boundary.
 */
function edgeScore(
  filled: (x: number, y: number) => boolean,
  x: number,
  y: number,
): number {
  const directions = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [0.7, 0.7],
    [-0.7, 0.7],
    [0.7, -0.7],
    [-0.7, -0.7],
  ];
  const radii = [3, 7, 13];
  const weights = [0.55, 0.3, 0.15];

  let score = 0;
  for (let r = 0; r < radii.length; r++) {
    let outside = 0;
    for (const [dx, dy] of directions) {
      if (!filled(Math.round(x + dx * radii[r]), Math.round(y + dy * radii[r]))) {
        outside++;
      }
    }
    score += (outside / directions.length) * weights[r];
  }
  return Math.min(1, score * 1.35);
}

/** Groups particles by quantised alpha so each frame sets few fill styles. */
function bucketByAlpha(particles: Particle[]): Particle[][] {
  const buckets: Particle[][] = Array.from({ length: ALPHA_BUCKETS }, () => []);
  for (const particle of particles) {
    const index = Math.min(
      ALPHA_BUCKETS - 1,
      Math.floor(particle.alpha * ALPHA_BUCKETS),
    );
    buckets[index].push(particle);
  }
  return buckets;
}

/** Cheap deterministic value noise, used only to clump the grain. */
function hashNoise(x: number, y: number): number {
  const value = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
