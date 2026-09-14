import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentSection, DocumentType } from '@chc/contracts';

import { getTenantScope } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { project } from '../financial-model/domain/projection';
import { decodeAssumptions } from '../financial-model/domain/assumption-codec';

/**
 * Resolving a document's data context (doc 16 §§1-2).
 *
 * Every figure a document states is read here from the record that owns it. A
 * section that cannot be resolved produces a GAP saying what is missing and
 * what would fix it — never a zero, a blank, or a plausible substitute.
 *
 * Document types whose data belongs to a release not yet built are declared
 * unavailable rather than rendered empty. An empty forty-page proposal is
 * worse than no proposal: someone would send it.
 */

export interface DocumentContext {
  sections: DocumentSection[];
  sourceDatasets: Array<{ name: string; detail: string }>;
  financialModel: string | null;
  title: string;
}

interface ResolveInput {
  facilityId: string;
  documentType: DocumentType;
  narratives: Record<string, string>;
  financialModelId?: string;
  partnershipId?: string;
}

/**
 * Which document types this release can actually populate, and where the rest
 * get their data from.
 *
 * Stated rather than silently absent, so a caller is told which release
 * provides what they asked for instead of receiving a hollow document.
 */
export const UNAVAILABLE_TYPES: Partial<Record<DocumentType, string>> = {
  PRE_ASSESSMENT_REPORT: 'the pre-assessment instrument (Release 2 captures it; its report is not yet built)',
  DUE_DILIGENCE_REPORT: 'the due-diligence assessment (Release 2 captures it; its report is not yet built)',
  IMPLEMENTATION_PLAN: 'projects, phases and milestones (Release 6)',
  COMMISSIONING_REPORT: 'commissioning records and asset registers (Release 6)',
  MONTHLY_REPORT: 'clinical, pharmacy and laboratory activity (Releases 7 and 8)',
  QUARTERLY_REPORT: 'clinical, pharmacy and laboratory activity (Releases 7 and 8)',
  ANNUAL_REPORT: 'a full year of operations (Releases 7 to 10)',
  LETTER: 'the letter generator, which produces letters directly rather than as generated documents',
  // Legal agreements are generated through POST /contracts/generate, which
  // assembles them from the partnership configuration and applies the
  // mandatory draft banner. Routing them here would bypass that.
  MANAGEMENT_AGREEMENT: 'the contract generator at POST /contracts/generate',
  MOU: 'the contract generator at POST /contracts/generate',
};

@Injectable()
export class DocumentContextService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(input: ResolveInput): Promise<DocumentContext> {
    const unavailable = UNAVAILABLE_TYPES[input.documentType];
    if (unavailable) {
      throw new BadRequestException(
        `A ${humanise(input.documentType)} cannot be generated yet: it needs ${unavailable}. ` +
          'Generating it now would produce a document with nothing in it.',
      );
    }

    const facility = await this.facility(input.facilityId);

    switch (input.documentType) {
      case 'BASELINE_REPORT':
        return this.baselineReport(facility, input);
      case 'NEEDS_ASSESSMENT':
        return this.needsAssessment(facility, input);
      case 'CAPITAL_PLAN':
        return this.capitalPlan(facility, input);
      case 'FIVE_YEAR_FINANCIAL_REPORT':
        return this.financialReport(facility, input);
      case 'BUSINESS_CASE':
      case 'FULL_PROPOSAL':
      case 'CHAIRMAN_BRIEF':
        return this.assembled(facility, input);
      default:
        throw new BadRequestException(`No resolver is registered for ${humanise(input.documentType)}.`);
    }
  }

  // ---------------------------------------------------------------------------

  private async baselineReport(facility: Facility, input: ResolveInput): Promise<DocumentContext> {
    const snapshot = await this.prisma.baselineSnapshot.findFirst({
      where: { facilityId: facility.id },
      orderBy: { sequence: 'desc' },
      select: {
        id: true,
        label: true,
        asOfDate: true,
        sealedAt: true,
        contentHash: true,
        metrics: {
          orderBy: { metricCode: 'asc' },
          select: {
            metricCode: true,
            metricName: true,
            numericValue: true,
            textValue: true,
            unit: true,
            classification: true,
            sourceReference: true,
          },
        },
      },
    });

    const sections: DocumentSection[] = [];
    const sourceDatasets: DocumentContext['sourceDatasets'] = [];

    if (!snapshot) {
      // The whole document rests on a sealed Day 0. Without one there is
      // nothing to report, and saying so is the only honest output.
      sections.push({
        key: 'baseline',
        heading: 'Baseline position',
        sequence: 1,
        narrative: input.narratives.baseline,
        clauses: [],
        fields: [
          {
            kind: 'GAP',
            label: 'Sealed baseline',
            reason: 'No baseline has been sealed for this facility.',
            remedy: 'Complete a field assessment and seal the baseline, then generate this report again.',
            source: 'baseline_snapshot',
          },
        ],
      });

      return { sections, sourceDatasets, financialModel: null, title: `Baseline Report — ${facility.name}` };
    }

    sourceDatasets.push({
      name: `baseline_snapshot#${snapshot.id.slice(0, 8)}`,
      detail: `${snapshot.label}, as of ${iso(snapshot.asOfDate)}, sealed ${iso(snapshot.sealedAt)}`,
    });

    sections.push({
      key: 'baseline',
      heading: 'Baseline position',
      sequence: 1,
      narrative: input.narratives.baseline,
      clauses: [],
      fields: snapshot.metrics.map((metric) => {
        // A metric recorded as not captured stays not captured. This is the
        // single most important line in the document pipeline: the sealed
        // baseline already distinguished observation from absence, and the
        // report must not quietly close that distinction (spec §12, §82).
        if (metric.numericValue === null && metric.textValue === null) {
          return {
            kind: 'GAP' as const,
            label: metric.metricName,
            reason: metric.sourceReference ?? 'This metric was not captured at baseline.',
            remedy: 'It cannot be added to a sealed baseline. Record it in the next assessment cycle.',
            source: `baseline_metric.${metric.metricCode}`,
          };
        }

        return {
          kind: 'VALUE' as const,
          label: metric.metricName,
          value: metric.numericValue !== null ? Number(metric.numericValue) : metric.textValue!,
          unit: metric.unit ?? undefined,
          classification: metric.classification,
          source: `baseline_metric.${metric.metricCode}`,
        };
      }),
    });

    const evidence = await this.prisma.evidence.groupBy({
      by: ['classification'],
      where: { facilityId: facility.id },
      _count: true,
    });

    if (evidence.length > 0) {
      const total = evidence.reduce((sum, row) => sum + row._count, 0);
      const verified = evidence.find((row) => row.classification === 'VERIFIED')?._count ?? 0;

      sourceDatasets.push({ name: 'evidence', detail: `${total} item(s), ${verified} verified` });
    }

    return { sections, sourceDatasets, financialModel: null, title: `Baseline Report — ${facility.name}` };
  }

  private async needsAssessment(facility: Facility, input: ResolveInput): Promise<DocumentContext> {
    const needs = await this.prisma.need.findMany({
      where: { facilityId: facility.id },
      orderBy: { reference: 'asc' },
      select: {
        id: true,
        reference: true,
        title: true,
        unlinkedReason: true,
        finding: { select: { reference: true, severity: true, priorityClass: true } },
        recommendations: {
          orderBy: { reference: 'asc' },
          select: { reference: true, title: true, priorityClass: true },
        },
      },
    });

    const sections: DocumentSection[] = [
      {
        key: 'needs',
        heading: 'Identified needs',
        sequence: 1,
        narrative: input.narratives.needs,
        clauses: [],
        fields:
          needs.length === 0
            ? [
                {
                  kind: 'GAP',
                  label: 'Identified needs',
                  reason: 'No needs have been recorded for this facility.',
                  remedy: 'Derive needs from the assessment findings, then generate this report again.',
                  source: 'need',
                },
              ]
            : needs.map((need) => ({
                kind: 'VALUE' as const,
                label: `${need.reference} ${need.title}`,
                value: need.finding
                  ? `${need.recommendations.length} recommendation(s); from finding ${need.finding.reference} (${need.finding.severity})`
                  : `${need.recommendations.length} recommendation(s); no finding — ${need.unlinkedReason ?? 'reason not recorded'}`,
                // A need traced to a finding is as verified as the finding
                // that produced it; one asserted without is REPORTED, and the
                // document says which it is.
                classification: need.finding ? 'VERIFIED' : 'REPORTED',
                source: `need.${need.reference}`,
              })),
      },
    ];

    return {
      sections,
      sourceDatasets: [{ name: 'need', detail: `${needs.length} need(s)` }],
      financialModel: null,
      title: `Needs Assessment — ${facility.name}`,
    };
  }

  private async capitalPlan(facility: Facility, input: ResolveInput): Promise<DocumentContext> {
    const plan = await this.prisma.capexPlan.findFirst({
      where: { facilityId: facility.id },
      orderBy: [{ versionNumber: 'desc' }],
      select: {
        id: true,
        name: true,
        versionNumber: true,
        status: true,
        lines: {
          orderBy: [{ priorityClass: 'asc' }],
          select: {
            category: true,
            description: true,
            estimatedCostMinor: true,
            approvedCostMinor: true,
            priorityClass: true,
            classification: true,
            costBasis: true,
            status: true,
          },
        },
      },
    });

    if (!plan) {
      return {
        sections: [
          {
            key: 'capex',
            heading: 'Capital plan',
            sequence: 1,
            narrative: input.narratives.capex,
            clauses: [],
            fields: [
              {
                kind: 'GAP',
                label: 'Capital plan',
                reason: 'No capital plan has been prepared for this facility.',
                remedy: 'Prepare a capital plan from the recommendations, then generate this report again.',
                source: 'capex_plan',
              },
            ],
          },
        ],
        sourceDatasets: [],
        financialModel: null,
        title: `Capital Plan — ${facility.name}`,
      };
    }

    const estimated = plan.lines.reduce((sum, line) => sum + line.estimatedCostMinor, 0n);
    const approved = plan.lines.reduce((sum, line) => sum + (line.approvedCostMinor ?? 0n), 0n);

    const fields: DocumentSection['fields'] = plan.lines.map((line) => ({
      kind: 'VALUE' as const,
      label: `${line.priorityClass} ${line.category}: ${line.description}`,
      value: Number(line.approvedCostMinor ?? line.estimatedCostMinor) / 100,
      unit: 'NGN',
      classification: line.classification,
      source: 'capex_line',
      method: line.costBasis ?? undefined,
    }));

    // Totals are computed here from the same lines the document prints, so
    // the total and the detail can never disagree (§10).
    fields.push({
      kind: 'VALUE',
      label: 'Total estimated capital requirement',
      value: Number(estimated) / 100,
      unit: 'NGN',
      classification: 'ESTIMATED',
      source: 'capex_line (sum)',
      method: `Sum of ${plan.lines.length} line(s) as estimated.`,
    });

    if (approved > 0n) {
      fields.push({
        kind: 'VALUE',
        label: 'Total approved to date',
        value: Number(approved) / 100,
        unit: 'NGN',
        classification: 'VERIFIED',
        source: 'capex_line (sum of approved)',
        method: `Sum of ${plan.lines.filter((line) => line.status === 'APPROVED').length} approved line(s).`,
      });
    }

    return {
      sections: [
        {
          key: 'capex',
          heading: `Capital plan — ${plan.name} v${plan.versionNumber}`,
          sequence: 1,
          narrative: input.narratives.capex,
          clauses: [],
          fields,
        },
      ],
      sourceDatasets: [
        { name: `capex_plan#${plan.id.slice(0, 8)}`, detail: `${plan.name} v${plan.versionNumber}, ${plan.status}` },
      ],
      financialModel: null,
      title: `Capital Plan — ${facility.name}`,
    };
  }

  private async financialReport(facility: Facility, input: ResolveInput): Promise<DocumentContext> {
    const model = await this.prisma.financialModel.findFirst({
      where: {
        facilityId: facility.id,
        ...(input.financialModelId ? { id: input.financialModelId } : { status: { not: 'SUPERSEDED' } }),
      },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        name: true,
        versionNumber: true,
        status: true,
        horizonMonths: true,
        assumptions: { select: { code: true, label: true, numericValue: true, unit: true, rationale: true } },
        scenarios: {
          where: { scenarioType: 'BASE' },
          select: { breakEvenMonth: true, paybackMonth: true, computedAt: true },
        },
      },
    });

    if (!model) {
      return {
        sections: [gapSection('financial', 'Five-year financial projection', {
          reason: 'No financial model has been built for this facility.',
          remedy: 'Build a model, compute its base scenario, then generate this report again.',
          source: 'financial_model',
        }, input.narratives.financial)],
        sourceDatasets: [],
        financialModel: null,
        title: `Five-Year Financial Report — ${facility.name}`,
      };
    }

    const scenario = model.scenarios[0];
    const fields: DocumentSection['fields'] = [];

    if (!scenario || scenario.computedAt === null) {
      fields.push({
        kind: 'GAP',
        label: 'Base case projection',
        reason: `Model "${model.name}" v${model.versionNumber} has no computed base scenario.`,
        remedy: 'Compute the base scenario, then generate this report again.',
        source: 'model_scenario',
      });
    } else {
      const assumptions = decodeAssumptions(
        model.assumptions.map((row) => ({
          code: row.code,
          label: row.label,
          numericValue: Number(row.numericValue),
          unit: row.unit,
        })),
      );

      const result = project(assumptions, { horizonMonths: model.horizonMonths });

      fields.push(
        {
          kind: 'VALUE',
          label: 'Five-year revenue',
          value: result.totalRevenueMinor / 100,
          unit: 'NGN',
          classification: 'PROJECTED',
          source: `financial_model#${model.id.slice(0, 8)}`,
          method: `Projected over ${model.horizonMonths} months from the stated assumptions.`,
        },
        {
          kind: 'VALUE',
          label: 'Five-year operating surplus',
          value: result.totalSurplusMinor / 100,
          unit: 'NGN',
          classification: 'PROJECTED',
          source: `financial_model#${model.id.slice(0, 8)}`,
          method: 'Net of uncollectable revenue, direct costs, operating costs, incentives and depreciation.',
        },
      );

      // Null means it never happens within the horizon. Rendering a month
      // here would be the single most misleading figure the system could
      // produce, so it stays a gap with the reason stated.
      fields.push(
        result.breakEvenPeriod === null
          ? {
              kind: 'GAP',
              label: 'Break-even month',
              reason: `On these assumptions the facility does not break even within ${model.horizonMonths} months.`,
              remedy: 'Revise the assumptions, or state in the narrative why the case is made on other grounds.',
              source: 'financial_model (computed)',
            }
          : {
              kind: 'VALUE',
              label: 'Break-even month',
              value: result.breakEvenPeriod,
              classification: 'PROJECTED',
              source: 'financial_model (computed)',
              method: 'First month in which cumulative surplus turns non-negative.',
            },
      );

      fields.push(
        result.paybackPeriod === null
          ? {
              kind: 'GAP',
              label: 'Capital payback month',
              reason: `The investment is not recovered within ${model.horizonMonths} months on these assumptions.`,
              remedy: 'Revise the assumptions, or state the intended recovery period in the narrative.',
              source: 'financial_model (computed)',
            }
          : {
              kind: 'VALUE',
              label: 'Capital payback month',
              value: result.paybackPeriod,
              classification: 'PROJECTED',
              source: 'financial_model (computed)',
              method: 'First month in which cumulative net cash covers total investment.',
            },
      );

      fields.push({
        kind: 'VALUE',
        label: 'Working capital required',
        value: (result.lowestCashMinor < 0 ? Math.abs(result.lowestCashMinor) : 0) / 100,
        unit: 'NGN',
        classification: 'PROJECTED',
        source: 'financial_model (computed)',
        method: `The deepest the cash balance goes, reached in month ${result.lowestCashPeriod}.`,
      });
    }

    const assumptionFields: DocumentSection['fields'] = model.assumptions.map((row) => ({
      kind: 'VALUE' as const,
      label: row.label,
      value: Number(row.numericValue),
      unit: row.unit ?? undefined,
      // An assumption is never anything else, however confident anyone is.
      classification: 'ASSUMPTION',
      source: `model_assumption.${row.code}`,
      method: row.rationale ?? undefined,
    }));

    return {
      sections: [
        {
          key: 'financial',
          heading: 'Five-year financial projection',
          sequence: 1,
          narrative: input.narratives.financial,
          clauses: [],
          fields,
        },
        {
          key: 'assumptions',
          heading: 'Assumptions this projection rests on',
          sequence: 2,
          narrative: input.narratives.assumptions,
          clauses: [],
          fields: assumptionFields,
        },
      ],
      sourceDatasets: [
        {
          name: `financial_model#${model.id.slice(0, 8)}`,
          detail: `${model.name} v${model.versionNumber}, ${model.status}, ${model.assumptions.length} assumptions`,
        },
      ],
      financialModel: `${model.name} v${model.versionNumber} (${model.status})`,
      title: `Five-Year Financial Report — ${facility.name}`,
    };
  }

  /** A proposal is the other documents assembled, not a separate set of figures. */
  private async assembled(facility: Facility, input: ResolveInput): Promise<DocumentContext> {
    const parts = await Promise.all([
      this.baselineReport(facility, input),
      this.needsAssessment(facility, input),
      this.capitalPlan(facility, input),
      this.financialReport(facility, input),
    ]);

    const sections: DocumentSection[] = [];
    let sequence = 1;

    for (const part of parts) {
      for (const section of part.sections.sort((a, b) => a.sequence - b.sequence)) {
        sections.push({ ...section, sequence: sequence++ });
      }
    }

    const title =
      input.documentType === 'CHAIRMAN_BRIEF'
        ? `Brief for the Chairman — ${facility.name}`
        : input.documentType === 'BUSINESS_CASE'
          ? `Business Case — ${facility.name}`
          : `Proposal — ${facility.name}`;

    return {
      sections,
      sourceDatasets: parts.flatMap((part) => part.sourceDatasets),
      financialModel: parts.map((part) => part.financialModel).find(Boolean) ?? null,
      title,
    };
  }

  private async facility(facilityId: string): Promise<Facility> {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const facility = await this.prisma.facility.findFirst({
      where: { id: facilityId, organisationId },
      select: { id: true, name: true, code: true, lifecycleStage: true },
    });

    if (!facility) throw new NotFoundException('No such facility, or it is not visible to you.');

    return facility;
  }
}

interface Facility {
  id: string;
  name: string;
  code: string;
  lifecycleStage: string;
}

function gapSection(
  key: string,
  heading: string,
  gap: { reason: string; remedy: string; source: string },
  narrative?: string,
): DocumentSection {
  return {
    key,
    heading,
    sequence: 1,
    narrative,
    clauses: [],
    fields: [{ kind: 'GAP', label: heading, ...gap }],
  };
}

function humanise(documentType: DocumentType): string {
  return documentType.toLowerCase().replace(/_/g, ' ');
}

function iso(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : 'not recorded';
}
