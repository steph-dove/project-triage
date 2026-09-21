import { Skeleton } from './badges';

export function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

// All three are sized to a finished analysis, so the panel keeps its height when the real
// content lands and the page does not jump under the reader.
export function SummarySkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

export function TagsSkeleton() {
  return (
    <div className="flex gap-2">
      <Skeleton className="h-7 w-28" />
      <Skeleton className="h-7 w-24" />
      <Skeleton className="h-7 w-20" />
    </div>
  );
}

export function RisksSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-10/12" />
      <Skeleton className="h-5 w-8/12" />
    </div>
  );
}
