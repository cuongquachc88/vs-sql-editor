import type { EngineId } from "../drivers/types";

interface EngineGlyph {
  short: string;
  accent: string;
}

const GLYPHS: Record<EngineId, EngineGlyph> = {
  postgres: { short: "PG", accent: "#336791" },
  mysql: { short: "MY", accent: "#00758F" },
  sqlite: { short: "SL", accent: "#003B57" },
  pglite: { short: "PL", accent: "#5C8AB8" },
  clickhouse: { short: "CH", accent: "#FFCC00" },
};

// Returns an inline SVG string for the engine monogram.
// `size` controls width/height in px. Caller embeds the SVG into HTML directly
// (no localResourceRoots needed because we have no external assets).
export function getEngineSvg(engine: EngineId, size = 28): string {
  const g = GLYPHS[engine];
  const radius = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.45);
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${engine}">
    <rect width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="${g.accent}"/>
    <text x="50%" y="50%" dominant-baseline="central" text-anchor="middle"
          font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"
          font-weight="700" font-size="${fontSize}" fill="white"
          letter-spacing="0.5">${g.short}</text>
  </svg>`;
}

export function engineAccentHex(engine: EngineId): string {
  return GLYPHS[engine].accent;
}
