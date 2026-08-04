"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Renders text as a dot-matrix grid.
 *
 * The glyphs are rasterised to an offscreen canvas in the page's own heaviest weight
 * (Roboto 900), then sampled on a fixed grid — every cell whose centre lands on ink
 * becomes a dot. That produces the LED-panel look without shipping a display font.
 *
 * Letters are drawn one at a time so tracking is controlled here rather than left to
 * inconsistent `letterSpacing` support.
 */

interface Dot {
  x: number;
  y: number;
}

interface DotTextProps {
  text: string;
  /** Cap height of the source glyphs, in pixels. */
  fontSize?: number;
  /** Distance between grid cells. Larger means a coarser, blockier matrix. */
  gridStep?: number;
  /** Extra space inserted between glyphs. */
  tracking?: number;
  color?: string;
  className?: string;
}

export function DotText({
  text,
  fontSize = 86,
  gridStep = 7.6,
  tracking = 11,
  color = "#111111",
  className = "",
}: DotTextProps) {
  const [dots, setDots] = useState<Dot[]>([]);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const measured = useRef<string>("");

  useEffect(() => {
    // Re-sampling is only needed when the inputs actually change.
    const key = `${text}|${fontSize}|${gridStep}|${tracking}`;
    if (measured.current === key) return;
    measured.current = key;

    let cancelled = false;

    // Sampling before the webfont resolves would rasterise the fallback and bake the
    // wrong glyph shapes into the grid, so wait for fonts to settle first.
    const sample = async () => {
      try {
        await document.fonts.ready;
      } catch {
        // An older browser without the font-loading API still renders something
        // reasonable from the fallback stack.
      }
      if (cancelled) return;
      rasterise();
    };

    const rasterise = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      // Follow whatever family the page actually resolved, so the matrix is built from
      // Roboto rather than a hardcoded stack that may not be installed.
      const family =
        getComputedStyle(document.body).fontFamily ||
        '"Helvetica Neue", Helvetica, Arial, sans-serif';
      const font = `900 ${fontSize}px ${family}`;

      // First pass: measure, so the sampling canvas is only as large as it needs to be.
      ctx.font = font;
      const advances = Array.from(text, (char) => ctx.measureText(char).width);
      const totalWidth =
        advances.reduce((sum, w) => sum + w, 0) +
        tracking * Math.max(0, text.length - 1);

      const padding = Math.ceil(fontSize * 0.3);
      const canvasWidth = Math.ceil(totalWidth) + padding * 2;
      const canvasHeight = Math.ceil(fontSize * 1.5) + padding * 2;

      canvas.width = canvasWidth;
      canvas.height = canvasHeight;

      // The context resets when the canvas is resized.
      ctx.font = font;
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "#000";

      let cursor = padding;
      const baseline = padding + fontSize;
      for (let i = 0; i < text.length; i++) {
        ctx.fillText(text[i], cursor, baseline);
        cursor += advances[i] + tracking;
      }

      const pixels = ctx.getImageData(0, 0, canvasWidth, canvasHeight).data;

      // Second pass: sample the grid, and track the true ink bounds so the rendered SVG
      // has no dead margin.
      const found: Dot[] = [];
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;

      for (let y = gridStep / 2; y < canvasHeight; y += gridStep) {
        for (let x = gridStep / 2; x < canvasWidth; x += gridStep) {
          const px = Math.round(x);
          const py = Math.round(y);
          if (pixels[(py * canvasWidth + px) * 4 + 3] < 128) continue;

          found.push({ x, y });
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }

      if (found.length === 0) {
        setDots([]);
        setSize({ width: 0, height: 0 });
        return;
      }

      const radius = gridStep * 0.34;
      const originX = minX - radius;
      const originY = minY - radius;

      setDots(found.map((dot) => ({ x: dot.x - originX, y: dot.y - originY })));
      setSize({
        width: maxX - minX + radius * 2,
        height: maxY - minY + radius * 2,
      });
    };

    void sample();

    return () => {
      cancelled = true;
    };
  }, [text, fontSize, gridStep, tracking]);

  if (dots.length === 0) {
    // Before sampling, reserve the line's height and expose the text to assistive
    // tech and to anyone with JavaScript disabled.
    return (
      <span
        className={`block ${className}`}
        style={{ height: fontSize * 1.05 }}
      >
        <span className="sr-only">{text}</span>
      </span>
    );
  }

  const radius = gridStep * 0.34;

  return (
    <svg
      className={`block ${className}`}
      viewBox={`0 0 ${size.width} ${size.height}`}
      width={size.width}
      height={size.height}
      role="img"
      aria-label={text}
      style={{ maxWidth: "100%", height: "auto" }}
    >
      {dots.map((dot, index) => (
        <circle key={index} cx={dot.x} cy={dot.y} r={radius} fill={color} />
      ))}
    </svg>
  );
}
