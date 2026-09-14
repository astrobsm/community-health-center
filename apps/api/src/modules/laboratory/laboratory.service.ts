import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { ReasonRequiredError, ResultNotVerifiedError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';
import { FinanceService } from '../finance/finance.service';
import { postCharge } from '../finance/domain/posting';

import {
  DEFAULT_ESCALATION,
  flagResult,
  isCritical,
  nextEscalation,
  selfVerificationNote,
  type EscalationStep,
  type ReferenceRange,
} from './domain/critical-result';

/**
 * The laboratory (spec §29, acceptance criterion I).
 *
 *   order -> charge -> sample -> result -> verification -> clinical record
 *
 * Two rules:
 *
 *  - An unverified result is a machine reading, not a clinical fact. It is not
 *    visible for clinical use, because a clinician shown a number will act on
 *    it, and nobody has yet checked it against the sample or the method.
 *
 *  - A critical result escalates until a person acknowledges it. Not until a
 *    notification is sent — until somebody says they have it. A potassium of
 *    7.2 delivered to an empty room is a patient who may die of a message.
 */
@Injectable()
export class LaboratoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly finance: FinanceService,
    private readonly config: ConfigService,
  ) {}

  private now(): Date {
    return new Date();
  }

  /** Order tests. Each orderable test raises its charge at the point of ordering. */
  async order(input: {
    encounterId: string;
    testIds: string[];
    clinicalIndication?: string;
    priority?: string;
    /**
     * Price per test, from the tariff in force.
     *
     * Supplied by the caller because a lab test's price lives in the tariff,
     * not on the test itself. A test with no price given is charged nothing
     * and SAYS so on the response, rather than quietly appearing free.
     */
    pricesMinor?: Record<string, number>;
  }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const encounter = await this.prisma.encounter.findFirst({
      where: { id: input.encounterId, organisationId },
      select: { id: true, facilityId: true, patientId: true, reference: true, status: true },
    });

    if (!encounter || !facilityIds.includes(encounter.facilityId)) {
      throw new NotFoundException('No such encounter, or it is not visible to you.');
    }

    const tests = await this.prisma.labTest.findMany({
      where: { id: { in: input.testIds } },
      select: { id: true, code: true, name: true, specimenType: true },
    });

    if (tests.length !== input.testIds.length) {
      const found = new Set(tests.map((test) => test.id));
      throw new BadRequestException(
        `Unknown test(s): ${input.testIds.filter((id) => !found.has(id)).join(', ')}.`,
      );
    }

    const orderedAt = this.now();
    const count = await this.prisma.labOrder.count({ where: { facilityId: encounter.facilityId } });

    const result = await this.prisma.$transaction(async (tx) => {
      const order = await tx.labOrder.create({
        data: {
          encounterId: encounter.id,
          organisationId,
          facilityId: encounter.facilityId,
          reference: `LAB-${String(count + 1).padStart(7, '0')}`,
          clinicalIndication: input.clinicalIndication,
          orderedBy: context?.userId,
          orderedAt,
        },
        select: { id: true, reference: true, orderedAt: true },
      });

      const items: Array<{ id: string; testName: string; chargeMinor: number; unpricedNote?: string }> = [];

      for (const test of tests) {
        const priceMinor = input.pricesMinor?.[test.id] ?? 0;

        // Charged when ordered, not when resulted: the facility has committed
        // the reagent and the scientist's time the moment the order is placed.
        const charge = await tx.charge.create({
          data: {
            organisationId,
            facilityId: encounter.facilityId,
            encounterId: encounter.id,
            description: `${test.name} (${test.code})`,
            quantity: 1,
            unitPriceMinor: BigInt(priceMinor),
            amountMinor: BigInt(priceMinor),
            serviceDate: orderedAt,
            status: 'RAISED',
            classification: 'ACTUAL',
            createdBy: context?.userId,
          },
          select: { id: true, description: true, amountMinor: true },
        });

        const item = await tx.labOrderItem.create({
          data: {
            labOrderId: order.id,
            labTestId: test.id,
            organisationId,
            facilityId: encounter.facilityId,
            chargeId: charge.id,
          },
          select: { id: true },
        });

        if (priceMinor > 0) {
          await this.finance.post(
            postCharge({
              chargeId: charge.id,
              description: charge.description,
              amountMinor: priceMinor,
              kind: 'LABORATORY',
            }),
            { facilityId: encounter.facilityId, entryDate: orderedAt },
            tx,
          );
        }

        items.push({
          id: item.id,
          testName: test.name,
          chargeMinor: priceMinor,
          ...(priceMinor === 0
            ? {
                unpricedNote:
                  'No tariff price was supplied for this test, so nothing was charged. If it should be ' +
                  'charged, price it in the tariff and raise the charge before the encounter is invoiced.',
              }
            : {}),
        });
      }

      return { order, items };
    });

    await this.audit.record({
      action: 'laboratory.order',
      entityType: 'lab_order',
      entityId: result.order.id,
      facilityId: encounter.facilityId,
      newValue: { reference: result.order.reference, tests: tests.map((test) => test.code) },
    });

    return {
      ...result.order,
      items: result.items,
      totalChargedMinor: result.items.reduce((sum, item) => sum + item.chargeMinor, 0).toString(),
    };
  }

  /** Record that a sample was taken. */
  async collectSample(input: { labOrderItemId: string; sampleType: string; container?: string }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const item = await this.prisma.labOrderItem.findFirst({
      where: { id: input.labOrderItemId, organisationId },
      select: { id: true, facilityId: true, labTest: { select: { name: true } } },
    });

    if (!item || !facilityIds.includes(item.facilityId)) {
      throw new NotFoundException('No such lab order item, or it is not visible to you.');
    }

    const count = await this.prisma.labSample.count({ where: { facilityId: item.facilityId } });
    const now = this.now();

    const sample = await this.prisma.labSample.create({
      data: {
        labOrderItemId: item.id,
        organisationId,
        facilityId: item.facilityId,
        accessionNumber: `A${String(count + 1).padStart(8, '0')}`,
        sampleType: input.sampleType,
        container: input.container,
        collectedBy: context?.userId,
        collectedAt: now,
        receivedAt: now,
      },
      select: { id: true, accessionNumber: true, sampleType: true, collectedAt: true },
    });

    await this.audit.record({
      action: 'laboratory.sample.collect',
      entityType: 'lab_sample',
      entityId: sample.id,
      facilityId: item.facilityId,
      newValue: { accession: sample.accessionNumber, test: item.labTest.name },
    });

    return sample;
  }

  /**
   * Reject a sample.
   *
   * A real event with a clinical consequence — the patient must be bled again
   * — so it is recorded rather than discarded, and the clinician who ordered
   * the test can see why the result never came.
   */
  async rejectSample(sampleId: string, input: { reason: string }) {
    const { organisationId, facilityIds } = getTenantScope();

    const sample = await this.prisma.labSample.findFirst({
      where: { id: sampleId, organisationId },
      select: { id: true, facilityId: true, accessionNumber: true, rejectedAt: true },
    });

    if (!sample || !facilityIds.includes(sample.facilityId)) {
      throw new NotFoundException('No such sample, or it is not visible to you.');
    }

    if (sample.rejectedAt) throw new BadRequestException('This sample has already been rejected.');
    if ((input.reason ?? '').trim().length < 5) throw new ReasonRequiredError('Rejecting a sample');

    const rejected = await this.prisma.labSample.update({
      where: { id: sample.id },
      data: { rejectedAt: this.now(), rejectionReason: input.reason },
      select: { id: true, accessionNumber: true, rejectedAt: true, rejectionReason: true },
    });

    await this.audit.record({
      action: 'laboratory.sample.reject',
      entityType: 'lab_sample',
      entityId: sample.id,
      facilityId: sample.facilityId,
      newValue: { accession: sample.accessionNumber },
      reason: input.reason,
      severity: 'NOTICE',
    });

    return {
      ...rejected,
      note: 'The ordering clinician can see the test was not done and why. The patient will need another sample.',
    };
  }

  /**
   * Enter a result.
   *
   * Flagged against the reference range immediately, but NOT released: it is
   * a machine reading until a scientist has verified it.
   */
  async enterResult(input: {
    sampleId: string;
    labTestId: string;
    numericValue?: number;
    textValue?: string;
    unit?: string;
    comment?: string;
  }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const sample = await this.prisma.labSample.findFirst({
      where: { id: input.sampleId, organisationId },
      select: { id: true, facilityId: true, accessionNumber: true, rejectedAt: true },
    });

    if (!sample || !facilityIds.includes(sample.facilityId)) {
      throw new NotFoundException('No such sample, or it is not visible to you.');
    }

    if (sample.rejectedAt) {
      throw new BadRequestException(
        `Sample ${sample.accessionNumber} was rejected, so a result on it would be a result on nothing.`,
      );
    }

    if (input.numericValue === undefined && !input.textValue) {
      throw new BadRequestException('A result needs a value — a number or text.');
    }

    const range = await this.referenceRange(input.labTestId);
    const flag = input.numericValue !== undefined && range ? flagResult(input.numericValue, range) : 'ABNORMAL';

    const result = await this.prisma.labResult.create({
      data: {
        sampleId: sample.id,
        labTestId: input.labTestId,
        organisationId,
        facilityId: sample.facilityId,
        numericValue: input.numericValue,
        textValue: input.textValue,
        unit: input.unit,
        flag: input.numericValue !== undefined && range ? flag : undefined,
        status: 'PRELIMINARY',
        resultedBy: context?.userId,
        resultedAt: this.now(),
        comment: input.comment,
        createdBy: context?.userId,
      },
      select: { id: true, numericValue: true, textValue: true, unit: true, flag: true, status: true },
    });

    await this.audit.record({
      action: 'laboratory.result.enter',
      entityType: 'lab_result',
      entityId: result.id,
      facilityId: sample.facilityId,
      newValue: { accession: sample.accessionNumber, flag: result.flag ?? 'not flagged' },
    });

    return {
      ...result,
      numericValue: result.numericValue === null ? null : Number(result.numericValue),
      isCritical: result.flag ? isCritical(result.flag) : false,
      note:
        'Entered but not released. It is not visible for clinical use until a scientist has verified it ' +
        'against the sample and the method.',
    };
  }

  /**
   * Verify a result, releasing it to the clinical record.
   *
   * A critical result starts escalating here — from the moment it becomes a
   * clinical fact, not from the moment it was measured.
   */
  async verifyResult(resultId: string, input: { comment?: string }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const result = await this.prisma.labResult.findFirst({
      where: { id: resultId, organisationId },
      select: {
        id: true,
        facilityId: true,
        status: true,
        flag: true,
        numericValue: true,
        unit: true,
        resultedBy: true,
        sample: {
          select: {
            accessionNumber: true,
            labOrderItem: {
              select: {
                labTest: { select: { name: true, code: true } },
                labOrder: { select: { id: true, reference: true, orderedBy: true, encounterId: true } },
              },
            },
          },
        },
      },
    });

    if (!result || !facilityIds.includes(result.facilityId)) {
      throw new NotFoundException('No such result, or it is not visible to you.');
    }

    if (result.status === 'VERIFIED') throw new BadRequestException('This result has already been verified.');

    const verifiedAt = this.now();
    const critical = result.flag ? isCritical(result.flag) : false;

    const verified = await this.prisma.labResult.update({
      where: { id: result.id },
      data: { status: 'VERIFIED', verifiedBy: context?.userId, verifiedAt, comment: input.comment },
      select: { id: true, status: true, verifiedAt: true, flag: true },
    });

    const selfVerified = selfVerificationNote(result.resultedBy, context?.userId ?? null);

    await this.audit.record({
      action: 'laboratory.result.verify',
      entityType: 'lab_result',
      entityId: result.id,
      facilityId: result.facilityId,
      newValue: {
        accession: result.sample.accessionNumber,
        test: result.sample.labOrderItem.labTest.code,
        flag: result.flag,
        critical,
        selfVerified: selfVerified !== null,
      },
      severity: critical ? 'CRITICAL' : 'NOTICE',
    });

    return {
      ...verified,
      isCritical: critical,
      ...(selfVerified ? { selfVerificationNote: selfVerified } : {}),
      ...(critical
        ? {
            escalation: {
              startedAt: verifiedAt,
              note:
                `${result.sample.labOrderItem.labTest.name} is critical at ` +
                `${result.numericValue ?? ''}${result.unit ?? ''}. Escalation has started and will continue ` +
                'until somebody acknowledges it. Sending a notification is not the same as it being received.',
            },
          }
        : { note: 'Released to the clinical record.' }),
    };
  }

  /**
   * Which critical results still need somebody, and who to tell next.
   *
   * Computed on every call from the elapsed time, so a scheduler polling this
   * cannot let one go quiet.
   */
  async pendingCriticalResults(facilityId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const ladder = await this.config.json<EscalationStep[]>(
      'laboratory.criticalEscalation',
      [...DEFAULT_ESCALATION],
      facilityId,
    );

    const results = await this.prisma.labResult.findMany({
      where: {
        organisationId,
        facilityId,
        status: 'VERIFIED',
        acknowledgedAt: null,
        flag: { in: ['CRITICAL_LOW', 'CRITICAL_HIGH'] },
      },
      orderBy: { verifiedAt: 'asc' },
      select: {
        id: true,
        flag: true,
        numericValue: true,
        unit: true,
        verifiedAt: true,
        sample: {
          select: {
            accessionNumber: true,
            labOrderItem: {
              select: {
                labTest: { select: { name: true, code: true } },
                labOrder: {
                  select: {
                    reference: true,
                    orderedBy: true,
                    encounter: { select: { patient: { select: { mrn: true, givenName: true, familyName: true } } } },
                  },
                },
              },
            },
          },
        },
      },
    });

    const now = this.now();

    return results.map((result) => {
      const decision = nextEscalation(
        {
          startedAt: result.verifiedAt ?? now,
          acknowledgedAt: null,
          acknowledgedBy: null,
          // Delivery is not tracked per step yet: every due step is reported
          // on every call, which over-notifies rather than under-notifies.
          // Under-notifying a critical result is the failure that matters.
          deliveredSteps: [],
        },
        now,
        ladder,
      );

      const patient = result.sample.labOrderItem.labOrder.encounter.patient;

      return {
        resultId: result.id,
        accession: result.sample.accessionNumber,
        test: result.sample.labOrderItem.labTest.name,
        value: result.numericValue === null ? null : Number(result.numericValue),
        unit: result.unit,
        flag: result.flag,
        patient: { mrn: patient.mrn, name: `${patient.givenName} ${patient.familyName}` },
        orderedBy: result.sample.labOrderItem.labOrder.orderedBy,
        verifiedAt: result.verifiedAt,
        elapsedMinutes: decision.elapsedMinutes,
        notifyNow: decision.due.map((step) => step.notify),
        summary: decision.summary,
      };
    });
  }

  /**
   * Acknowledge a critical result.
   *
   * The only thing that stops escalation. Recorded with who and when, because
   * "the lab called someone" is not the same as a named clinician having the
   * number in front of them.
   */
  async acknowledgeResult(resultId: string, input: { actionTaken: string }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const result = await this.prisma.labResult.findFirst({
      where: { id: resultId, organisationId },
      select: {
        id: true,
        facilityId: true,
        status: true,
        flag: true,
        acknowledgedAt: true,
        verifiedAt: true,
        sample: { select: { accessionNumber: true } },
      },
    });

    if (!result || !facilityIds.includes(result.facilityId)) {
      throw new NotFoundException('No such result, or it is not visible to you.');
    }

    if (result.status !== 'VERIFIED') throw new ResultNotVerifiedError();
    if (result.acknowledgedAt) throw new BadRequestException('This result has already been acknowledged.');

    if ((input.actionTaken ?? '').trim().length < 5) {
      // An acknowledgement with no action is a button press. What was done
      // about it is the point.
      throw new ReasonRequiredError('Acknowledging a critical result');
    }

    const acknowledgedAt = this.now();

    await this.prisma.labResult.update({
      where: { id: result.id },
      data: { acknowledgedBy: context?.userId, acknowledgedAt, comment: input.actionTaken },
    });

    const minutes = result.verifiedAt
      ? Math.floor((acknowledgedAt.getTime() - result.verifiedAt.getTime()) / 60_000)
      : 0;

    await this.audit.record({
      action: 'laboratory.result.acknowledge',
      entityType: 'lab_result',
      entityId: result.id,
      facilityId: result.facilityId,
      newValue: { accession: result.sample.accessionNumber, minutesToAcknowledge: minutes },
      reason: input.actionTaken,
      severity: 'CRITICAL',
    });

    return {
      resultId: result.id,
      acknowledgedAt,
      minutesToAcknowledge: minutes,
      note: 'Escalation has stopped.',
    };
  }

  /** Results for an encounter. Unverified ones are withheld, and said to be. */
  async resultsForEncounter(encounterId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const encounter = await this.prisma.encounter.findFirst({
      where: { id: encounterId, organisationId },
      select: { id: true, facilityId: true },
    });

    if (!encounter || !facilityIds.includes(encounter.facilityId)) {
      throw new NotFoundException('No such encounter, or it is not visible to you.');
    }

    const items = await this.prisma.labOrderItem.findMany({
      where: { labOrder: { encounterId } },
      select: {
        id: true,
        labTest: { select: { name: true, code: true, unit: true } },
        samples: {
          select: {
            accessionNumber: true,
            rejectedAt: true,
            rejectionReason: true,
            results: {
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                numericValue: true,
                textValue: true,
                unit: true,
                flag: true,
                status: true,
                verifiedAt: true,
                acknowledgedAt: true,
                comment: true,
              },
            },
          },
        },
      },
    });

    return items.map((item) => ({
      test: item.labTest,
      samples: item.samples.map((sample) => ({
        accession: sample.accessionNumber,
        rejected: sample.rejectedAt !== null,
        rejectionReason: sample.rejectionReason,
        results: sample.results.map((result) =>
          result.status === 'VERIFIED'
            ? {
                id: result.id,
                value: result.numericValue === null ? result.textValue : Number(result.numericValue),
                unit: result.unit,
                flag: result.flag,
                status: result.status,
                verifiedAt: result.verifiedAt,
                isCritical: result.flag ? isCritical(result.flag) : false,
                acknowledged: result.acknowledgedAt !== null,
                comment: result.comment,
              }
            : {
                id: result.id,
                status: result.status,
                // The value is withheld deliberately. A clinician shown a
                // number acts on it, and nobody has checked this one yet.
                withheld:
                  'This result has not been verified. It is not available for clinical use until a scientist ' +
                  'has checked it against the sample and the method.',
              },
        ),
      })),
    }));
  }

  private async referenceRange(labTestId: string): Promise<ReferenceRange | null> {
    const range = await this.prisma.labReferenceRange.findFirst({
      where: { labTestId },
      select: { lowValue: true, highValue: true, criticalLow: true, criticalHigh: true },
    });

    if (!range) return null;

    return {
      lowNormal: range.lowValue === null ? null : Number(range.lowValue),
      highNormal: range.highValue === null ? null : Number(range.highValue),
      lowCritical: range.criticalLow === null ? null : Number(range.criticalLow),
      highCritical: range.criticalHigh === null ? null : Number(range.criticalHigh),
    };
  }
}
