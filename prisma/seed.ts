import { PrismaClient } from '@prisma/client';

const db = new PrismaClient();

// Uneven on purpose so pagination, filters and dashboard counts have something to show.
const intakes = [
  {
    title: 'Customer churn prediction model',
    description:
      'We lose roughly 4% of subscribers a month and cannot tell which accounts are at risk until they have already cancelled. We want a model scoring each account weekly, surfaced in the CS team dashboard.',
    budgetRange: '$50k-$100k',
    timeline: '3 months',
    industry: 'SaaS',
    status: 'ACCEPTED',
    tags: ['churn-prediction', 'machine-learning', 'customer-success'],
  },
  {
    title: 'Warehouse demand forecasting',
    description:
      'Seasonal stock planning is done in spreadsheets by one person. We need forecasts per SKU per region, with enough explainability that the planning team trusts the numbers.',
    budgetRange: '$100k-$250k',
    timeline: '6 months',
    industry: 'Retail',
    status: 'IN_REVIEW',
    tags: ['forecasting', 'supply-chain', 'time-series'],
  },
  {
    title: 'Clinical notes summarisation',
    description:
      'Physicians spend around 90 minutes a day on documentation. We would like draft summaries generated from consultation transcripts, reviewed and signed off by the clinician before anything enters the record.',
    budgetRange: '$250k+',
    timeline: '9 months',
    industry: 'Healthcare',
    status: 'IN_REVIEW',
    tags: ['nlp', 'summarisation', 'compliance'],
  },
  {
    title: 'Fraud detection for card-not-present transactions',
    description:
      'Our current rules engine flags too much. Analysts are drowning in false positives and genuine fraud is getting through in the noise.',
    budgetRange: '$100k-$250k',
    timeline: '4 months',
    industry: 'Fintech',
    status: 'ACCEPTED',
    tags: ['fraud-detection', 'anomaly-detection', 'real-time'],
  },
  {
    title: 'Internal knowledge base search',
    description:
      'Six years of Confluence, Notion and Google Docs. Nobody can find anything. We want semantic search across all three with permission-aware results.',
    budgetRange: '$50k-$100k',
    timeline: '2 months',
    industry: 'Professional Services',
    status: 'NEW',
    tags: ['semantic-search', 'rag', 'knowledge-management'],
  },
  {
    title: 'Predictive maintenance for fleet vehicles',
    description:
      'We run 400 refrigerated trucks. Unplanned compressor failures cost us a full load each time. Telematics data exists but nobody has modelled it.',
    budgetRange: '$100k-$250k',
    timeline: '6 months',
    industry: 'Logistics',
    status: 'NEW',
    tags: ['predictive-maintenance', 'iot', 'time-series'],
  },
  {
    title: 'Automated invoice data extraction',
    description:
      'Accounts payable keys in about 2,000 supplier invoices a month by hand across maybe 40 different layouts. Error rate is high and it is nobody idea of a good job.',
    budgetRange: '$25k-$50k',
    timeline: '6 weeks',
    industry: 'Manufacturing',
    status: 'ACCEPTED',
    tags: ['document-extraction', 'ocr', 'automation'],
  },
  {
    title: 'Recommendation engine for course catalogue',
    description:
      'Learners abandon after their first course. We think better next-course recommendations would help but we have no baseline to compare against.',
    budgetRange: '$50k-$100k',
    timeline: '3 months',
    industry: 'Education',
    status: 'DECLINED',
    tags: ['recommendations', 'personalisation', 'engagement'],
  },
  {
    title: 'Contract clause risk review',
    description:
      'Legal reviews every vendor contract manually. We want unusual or high-risk clauses flagged before a human opens the document, with the clause text cited.',
    budgetRange: '$100k-$250k',
    timeline: '5 months',
    industry: 'Legal',
    status: 'NEW',
    tags: ['nlp', 'risk-analysis', 'legal-tech'],
  },
  {
    title: 'Energy consumption anomaly alerts',
    description:
      'Building managers get a monthly bill and nothing else. By then an overnight HVAC fault has been running for three weeks. We want anomalies caught within a day.',
    budgetRange: '$25k-$50k',
    timeline: '2 months',
    industry: 'Energy',
    status: 'NEW',
    tags: ['anomaly-detection', 'iot', 'alerting'],
  },
  {
    title: 'Support ticket triage and routing',
    description:
      'Tickets are routed by keyword rules written in 2019. Roughly a third land on the wrong team and bounce at least twice before reaching someone who can help.',
    budgetRange: '$25k-$50k',
    timeline: '6 weeks',
    industry: 'SaaS',
    status: 'IN_REVIEW',
    tags: ['classification', 'routing', 'customer-support'],
  },
  {
    title: 'Real-time inventory sync across channels',
    description:
      'We sell on three marketplaces plus our own store. Stock counts drift and we oversell. This might not be an AI problem at all, which we are fine hearing.',
    budgetRange: '$50k-$100k',
    timeline: '3 months',
    industry: 'Retail',
    status: 'DECLINED',
    tags: ['data-engineering', 'integration', 'inventory'],
  },
  {
    title: 'Voice-of-customer theme extraction',
    description:
      'Survey free text, app reviews and support transcripts all get read by one researcher who writes a quarterly deck. We want themes and trends continuously.',
    budgetRange: '$25k-$50k',
    timeline: '2 months',
    industry: 'Consumer Goods',
    status: 'NEW',
    tags: ['nlp', 'topic-modelling', 'customer-insights'],
  },
  {
    title: 'ML platform assessment and roadmap',
    description:
      'Four teams have each built their own training pipeline. Before we commission any more models we want an honest assessment of what to consolidate and what to leave alone.',
    budgetRange: 'Not sure yet',
    timeline: 'Flexible',
    industry: 'Telecommunications',
    status: 'IN_REVIEW',
    tags: ['mlops', 'platform-strategy', 'assessment'],
  },
];

const summarise = (intake: (typeof intakes)[number]) =>
  `${intake.industry} client seeking ${intake.title.toLowerCase()}. Stated budget ${intake.budgetRange} over ${intake.timeline}. Scope is described in enough detail to estimate, though discovery would confirm data availability.`;

async function main() {
  // Wipe first so re-seeding does not double the rows; cascades clear the rest.
  await db.intake.deleteMany();

  const now = Date.now();

  for (const [i, intake] of intakes.entries()) {
    const { tags, ...fields } = intake;
    // Spread over time so relative timestamps are not all "14 rows, same second".
    const createdAt = new Date(now - (intakes.length - i) * 7_200_000);

    await db.intake.create({
      data: {
        ...fields,
        createdAt,
        tags: { create: tags.map((label) => ({ label })) },
        enrichment: {
          create: {
            state: 'READY',
            source: 'FALLBACK',
            summary: summarise(intake),
            risks: JSON.stringify([
              'Data availability and quality not yet confirmed',
              'Success metric not defined in the request',
            ]),
            promptVersion: 'seed',
            updatedAt: createdAt,
          },
        },
        events: {
          create: [
            { type: 'QUEUED', createdAt },
            { type: 'READY', createdAt: new Date(createdAt.getTime() + 3_000) },
          ],
        },
      },
    });
  }

  console.log(`Seeded ${intakes.length} intakes.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
