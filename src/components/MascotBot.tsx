/* 🌱 골든시드 로봇 마스코트 — 재사용 컴포넌트.
   public/mascot.svg 를 img로 렌더(그라디언트 id 충돌 없음). 🤖 이모지 대신 사용. */
export default function MascotBot({ size = 40, style }: { size?: number; style?: React.CSSProperties }) {
  return (
    <img
      src="/mascot.svg"
      width={size}
      height={Math.round((size * 264) / 240)}
      alt="골든시드 마스코트"
      draggable={false}
      style={{ display: "block", userSelect: "none", ...style }}
    />
  );
}
