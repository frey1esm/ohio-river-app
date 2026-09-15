export default function Loading() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        gap: 16,
        background: "var(--bg)",
        color: "var(--muted)",
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          border: "3px solid rgba(77,184,255,0.15)",
          borderTopColor: "var(--accent)",
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
        }}
      />
      <div style={{ fontFamily: "var(--font-head)", fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase" }}>
        Loading conditions…
      </div>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
