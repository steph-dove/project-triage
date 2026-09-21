import { BackToIntakes } from '@/components/back-link';

export default function IntakeNotFound() {
  return (
    <div className="space-y-6">
      <BackToIntakes />
      <div className="rounded-lg border border-line bg-card px-6 py-20 text-center">
        <h1 className="text-lg font-semibold">No intake with that id</h1>
        <p className="mt-2 text-muted">
          It may have been removed, or the link may be wrong.
        </p>
      </div>
    </div>
  );
}
