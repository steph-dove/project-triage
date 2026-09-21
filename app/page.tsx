import Link from 'next/link';
import { redirect } from 'next/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { NoFilterMatches, NoIntakesYet } from '@/components/empty-states';
import { IntakeCard } from '@/components/intake-card';
import { FilterChips, Pagination } from '@/components/list-controls';
import { isAnalysing, listIntakes } from '@/lib/intakes';
import { ListIntakesQuerySchema } from '@/lib/schemas';
import { STATUS_LABELS } from '@/lib/status';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function IntakeListPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const query = ListIntakesQuerySchema.parse({ page: params.page, status: params.status });
  const list = await listIntakes(query);

  // ?page=99 on a two-page list would otherwise render as "nothing matches this filter".
  if (list.items.length === 0 && list.page > 1) {
    redirect(query.status ? `/?status=${query.status}` : '/');
  }

  return (
    <div className="space-y-6 pb-24 sm:pb-0">
      <AutoRefresh enabled={list.items.some((intake) => isAnalysing(intake.enrichment))} />

      {list.totalAll > 0 && (
        <FilterChips counts={list.counts} totalAll={list.totalAll} active={query.status} />
      )}

      {list.totalAll === 0 && <NoIntakesYet />}

      {list.items.length === 0 && query.status && (
        <NoFilterMatches totalAll={list.totalAll} label={STATUS_LABELS[query.status]} />
      )}

      {list.items.length > 0 && (
        <>
          <ul className="space-y-4">
            {list.items.map((intake) => (
              <li key={intake.id}>
                <IntakeCard intake={intake} />
              </li>
            ))}
          </ul>
          <Pagination
            page={list.page}
            totalPages={list.totalPages}
            total={list.total}
            pageSize={list.pageSize}
            status={query.status}
          />
        </>
      )}

      <Link
        href="/intakes/new"
        className="fixed inset-x-0 bottom-0 z-10 block bg-ink py-4 text-center text-sm font-semibold text-card sm:hidden"
      >
        New intake
      </Link>
    </div>
  );
}
