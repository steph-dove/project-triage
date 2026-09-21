import { describe, expect, it } from 'vitest';
import { heuristicTriage } from '../../lib/ai/fallback';

const intake = (overrides: Partial<Parameters<typeof heuristicTriage>[0]> = {}) => ({
  title: 'Forecasting for a regional carrier',
  description:
    'We want to forecast freight demand across twenty depots. The current spreadsheet model is maintained by one analyst and nobody else understands it. We would like something the operations team can run themselves every morning.',
  budgetRange: '$50k-100k',
  timeline: '6 weeks',
  industry: 'Logistics',
  ...overrides,
});

describe('heuristicTriage', () => {
  it('always returns three tags and a summary', () => {
    const triage = heuristicTriage(intake());

    expect(triage.tags).toHaveLength(3);
    expect(triage.tags[0]).toBe('logistics');
    expect(triage.summary).toContain('Forecasting for a regional carrier');
  });

  it('flags a budget and a timeline that are not pinned down', () => {
    const triage = heuristicTriage(intake({ budgetRange: 'TBD', timeline: 'ASAP' }));

    expect(triage.risks).toHaveLength(2);
    expect(triage.risks[0]).toMatch(/Budget/);
    expect(triage.risks[1]).toMatch(/Timeline/);
  });

  it('flags regulated data and a thin brief', () => {
    const triage = heuristicTriage({
      ...intake(),
      description: 'We need a HIPAA compliant intake summariser.',
    });

    expect(triage.risks.some((r) => r.includes('compliance'))).toBe(true);
    expect(triage.risks.some((r) => r.includes('brief is thin'))).toBe(true);
  });

  it('says nothing when there is nothing to flag', () => {
    expect(heuristicTriage(intake()).risks).toEqual([]);
  });
});
