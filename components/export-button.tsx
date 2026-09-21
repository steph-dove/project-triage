// A plain link with no query string, so nothing about the current page can narrow the export.
export function ExportButton({ className = '' }: { className?: string }) {
  return (
    <a
      href="/api/intakes/export.csv"
      download
      className={`rounded-md border border-line bg-card px-4 py-2 text-sm font-medium transition-colors hover:border-faint ${className}`}
    >
      Export CSV
    </a>
  );
}
