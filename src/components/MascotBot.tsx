/* 🌱 골든시드 로고 — 재사용 컴포넌트.
   🔴 Electron file:// 에서 `/mascot.svg` 절대경로 img는 무조건 깨진다(헤더 로고 깨짐 실측).
   → 이미지 경로 없이 인라인으로 골드 원 + "C" 로고 렌더(GoldenSeedApp 헤더 로고와 통일). */
export default function MascotBot({ size = 40, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <div
      aria-label="골든시드"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: Math.max(4, Math.round(size * 0.3)),
        display: "grid",
        placeItems: "center",
        background: "linear-gradient(135deg,#f9dd86,#f5c451 55%,#c9a03f)",
        boxShadow: `0 ${Math.round(size * 0.09)}px ${Math.round(size * 0.28)}px rgba(245,196,81,.28)`,
        userSelect: "none",
        ...style,
      }}
    >
      <span
        style={{
          fontFamily: "'Bebas Neue',Arial Black,sans-serif",
          fontSize: Math.round(size * 0.72),
          fontWeight: 900,
          color: "#231a08",
          lineHeight: 1,
          marginTop: Math.max(1, Math.round(size * 0.03)),
        }}
      >
        C
      </span>
    </div>
  );
}
