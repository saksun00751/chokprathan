/**
 * App icon artwork for ImageResponse (PNG rasterizer).
 * Colors are the sRGB equivalents of the OKLCH tokens in globals.css, because the
 * icon rasterizer and some OS launchers don't parse OKLCH:
 * brand oklch(0.46 0.19 282) = #4e3dbc, gold oklch(0.84 0.13 84) = #f2c35e.
 */
export function IconArt({ size, padding = 0.16 }: { size: number; padding?: number }) {
  const inner = size * (1 - padding * 2);
  return (
    <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: "#4e3dbc" }}>
      <svg width={inner} height={inner} viewBox="0 0 32 32">
        <path
          d="M6 7H26A4 4 0 0 1 30 11V13A3 3 0 0 0 30 19V21A4 4 0 0 1 26 25H6A4 4 0 0 1 2 21V19A3 3 0 0 0 2 13V11A4 4 0 0 1 6 7Z"
          fill="#ffffff"
        />
        <path d="M10.5 9.5V22.5" stroke="#4e3dbc" strokeWidth="1.4" strokeDasharray="1.6 1.8" strokeLinecap="round" />
        <circle cx="19.5" cy="16" r="4.2" fill="#f2c35e" />
      </svg>
    </div>
  );
}
