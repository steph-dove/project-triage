import { Skeleton } from '@/components/badges';

// Sized to a real card (title, meta line, chips row) so nothing jumps when the rows land.
export default function ListLoading() {
  return (
    <div className="space-y-6">
      <div className="flex gap-2">
        {['all', 'new', 'in-review', 'accepted', 'declined'].map((chip) => (
          <Skeleton key={chip} className="h-10 w-24 rounded-full" />
        ))}
      </div>
      <div className="space-y-4">
        {[0, 1, 2, 3, 4].map((row) => (
          <div key={row} className="rounded-lg border border-line bg-card p-5">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="mt-3 h-4 w-1/3" />
            <div className="mt-4 flex gap-2">
              <Skeleton className="h-6 w-28" />
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
