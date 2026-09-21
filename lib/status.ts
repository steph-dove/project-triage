import type { TriageStatus } from './schemas';

export const STATUS_LABELS: Record<TriageStatus, string> = {
  NEW: 'New',
  IN_REVIEW: 'In review',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
};
