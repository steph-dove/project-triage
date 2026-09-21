import Link from 'next/link';

export function BackToIntakes() {
  return (
    <Link href="/" className="text-sm text-muted transition-colors hover:text-ink">
      ← Back to intakes
    </Link>
  );
}
