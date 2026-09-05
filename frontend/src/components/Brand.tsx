export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="GASX">
      <img className="brand-mark" src="/logo.png" alt="GASX" />
      {!compact && <span>GASX</span>}
    </div>
  );
}
