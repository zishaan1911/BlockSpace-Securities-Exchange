export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <div className="brand" aria-label="GASX">
      <svg className="brand-mark" viewBox="0 0 40 40" role="img" aria-hidden="true">
        <path d="M20 4 34 30h-8.4L20 19.8 14.4 30H6L20 4Z" fill="currentColor" opacity=".96" />
        <path d="M20 13.8 26.2 25H13.8L20 13.8Z" fill="#0b1016" />
        <path d="m9.2 33 5.1-8.2h11.4l5.1 8.2h-7.4L20 28l-3.4 5H9.2Z" fill="#4b89ff" />
      </svg>
      {!compact && <span>GASX</span>}
    </div>
  );
}
