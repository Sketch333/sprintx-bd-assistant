export function BrandMark({ compact = false }: { compact?: boolean }) {
  return <span className={compact ? 'brand-identity compact' : 'brand-identity'} aria-label={compact ? undefined : 'SprintX'}>
    <span className="brand-symbol" aria-hidden="true">
      <svg viewBox="0 0 32 32" role="img" focusable="false">
        <rect x="1" y="1" width="30" height="30" rx="9" fill="currentColor" />
        <text x="16" y="20.3" textAnchor="middle" fill="white" fontSize="11.2" fontWeight="800" fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif" letterSpacing="-.6">SX</text>
        <circle cx="24.7" cy="7.5" r="1.15" fill="#dee0ff" />
      </svg>
    </span>
    {!compact && <span className="brand-wordmark">SprintX</span>}
  </span>;
}
