import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { IssueInvoice, RaiseCharge, ReceivePayment, WaiveCharge } from '@chc/contracts';

import { ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { postCharge, postPatientPayment } from '../finance/domain/posting';
import { FinanceService } from '../finance/finance.service';

/**
 * Billing: charge, invoice, payment, waiver (spec §§31-32, doc 12 §5).
 *
 * This is the middle of the chain in doc 22 §1 — care to money. The pharmacy
 * and laboratory raise their own charges as they dispense and test; what
 * happens here is everything after: putting charges on an invoice, taking the
 * money, and recording the decision not to ask for it.
 *
 * Three things it will not do.
 *
 * It will not recognise revenue twice. The charge posts revenue when it is
 * raised, because that is when the facility earned it; the payment settles the
 * receivable and posts no revenue at all. A ledger that recognised revenue on
 * payment could not tell a good month from a month nobody paid for.
 *
 * It will not guess which invoice a payment settles. Every allocation is
 * explicit, because money applied to whichever invoice happened to be oldest is
 * money a patient cannot reconcile against what they were told they owed.
 *
 * It will not let a waiver be silent. A waived charge carries the reason and
 * the person who decided, and it reverses its own revenue posting rather than
 * leaving the facility's accounts claiming income it chose not to collect.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly finance: FinanceService,
  ) {}

  private now(): Date {
    return new Date();
  }

  private assertFacilityVisible(facilityId: string): void {
    const { facilityIds } = getTenantScope();
    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }
  }

  // ---------------------------------------------------------------------------
  // Charges
  // ---------------------------------------------------------------------------

  async raiseCharge(input: RaiseCharge) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const amountMinor = Math.round(input.quantity * input.unitPriceMinor);
    const context = tryGetContext();
    const serviceDate = new Date(input.serviceDate);

    const charge = await this.prisma.$transaction(async (tx) => {
      const row = await tx.charge.create({
        data: {
          id: randomUUID(),
          organisationId,
          facilityId: input.facilityId,
          encounterId: input.encounterId,
          description: input.description,
          quantity: input.quantity,
          unitPriceMinor: BigInt(input.unitPriceMinor),
          // Constrained in the database to equal quantity x unit price, so a
          // bill can never disagree with its own line.
          amountMinor: BigInt(amountMinor),
          serviceDate,
          status: 'RAISED',
          createdBy: context?.userId,
        },
        select: { id: true, description: true, amountMinor: true, status: true, serviceDate: true },
      });

      // Revenue is recognised now, when the facility earned it.
      await this.finance.post(
        postCharge({
          chargeId: row.id,
          description: row.description,
          amountMinor,
          kind: input.kind,
        }),
        { facilityId: input.facilityId, entryDate: serviceDate },
        tx,
      );

      return row;
    });

    await this.audit.record({
      action: 'billing.charge',
      entityType: 'charge',
      entityId: charge.id,
      facilityId: input.facilityId,
      newValue: { description: input.description, amountMinor, kind: input.kind },
    });

    return { ...charge, amountMinor: Number(charge.amountMinor) };
  }

  /**
   * Record that a patient will not be asked to pay.
   *
   * The charge is not deleted and the encounter is not altered: the care
   * happened and the record says so. What changes is that the facility stops
   * claiming the income, by reversing the posting the charge made.
   */
  async waive(input: WaiveCharge) {
    const { facilityIds } = getTenantScope();
    const context = tryGetContext();

    const charge = await this.prisma.charge.findFirst({
      where: { id: input.chargeId, facilityId: { in: [...facilityIds] } },
      select: {
        id: true,
        facilityId: true,
        description: true,
        amountMinor: true,
        status: true,
        serviceDate: true,
        invoiceItem: { select: { invoiceId: true } },
      },
    });

    if (!charge) throw new NotFoundException('No such charge, or it is not visible to you.');

    if (charge.status === 'WAIVED') {
      throw new BadRequestException(`"${charge.description}" is already waived.`);
    }

    if (charge.invoiceItem) {
      throw new BadRequestException(
        `"${charge.description}" is already on an invoice. Cancel or credit the invoice rather than ` +
          'waiving a line inside it, so the invoice the patient holds and the record agree.',
      );
    }

    if (!input.reason || input.reason.trim().length < 10) {
      throw new ReasonRequiredError('Waiving a charge');
    }

    const waived = await this.prisma.$transaction(async (tx) => {
      const row = await tx.charge.update({
        where: { id: charge.id },
        data: {
          status: 'WAIVED',
          waivedBy: context?.userId,
          waivedAt: this.now(),
          waiverReason: input.reason,
          version: { increment: 1 },
        },
        select: { id: true, status: true, waivedAt: true, amountMinor: true, description: true },
      });

      // The mirror image of the charge posting. Never an edit of the original
      // entry: the ledger is append-only and a reversal is a new entry (§44).
      const original = postCharge({
        chargeId: charge.id,
        description: charge.description,
        amountMinor: Number(charge.amountMinor),
        kind: 'OTHER',
      });

      await this.finance.post(
        {
          description: `Waiver: ${charge.description}`,
          sourceType: 'charge_waiver',
          sourceId: charge.id,
          lines: original.lines.map((line) => ({
            accountCode: line.accountCode,
            debitMinor: line.creditMinor,
            creditMinor: line.debitMinor,
            description: `Reversal — ${line.description}`,
          })),
        },
        { facilityId: charge.facilityId, entryDate: this.now() },
        tx,
      );

      return row;
    });

    await this.audit.record({
      action: 'billing.waive',
      entityType: 'charge',
      entityId: charge.id,
      facilityId: charge.facilityId,
      oldValue: { status: charge.status },
      newValue: { status: 'WAIVED', amountMinor: Number(charge.amountMinor), reason: input.reason },
      severity: 'NOTICE',
    });

    return { ...waived, amountMinor: Number(waived.amountMinor) };
  }

  // ---------------------------------------------------------------------------
  // Invoices
  // ---------------------------------------------------------------------------

  async issueInvoice(input: IssueInvoice) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const charges = await this.prisma.charge.findMany({
      where: { id: { in: input.chargeIds }, facilityId: input.facilityId },
      select: {
        id: true,
        description: true,
        quantity: true,
        unitPriceMinor: true,
        amountMinor: true,
        status: true,
        invoiceItem: { select: { invoiceId: true } },
      },
    });

    const missing = input.chargeIds.filter((id) => !charges.some((charge) => charge.id === id));
    if (missing.length > 0) {
      throw new NotFoundException(
        `${missing.length} of the charges named do not exist at this facility, so the invoice would ` +
          'bill for something that never happened.',
      );
    }

    const alreadyBilled = charges.filter((charge) => charge.invoiceItem !== null);
    if (alreadyBilled.length > 0) {
      // The failure this prevents is a patient being asked twice for the same
      // consultation, which is how a facility loses the trust of a village.
      throw new BadRequestException(
        `${alreadyBilled.length} charge(s) are already on an invoice: ` +
          `${alreadyBilled.map((charge) => `"${charge.description}"`).join(', ')}.`,
      );
    }

    const waived = charges.filter((charge) => charge.status === 'WAIVED' || charge.status === 'CANCELLED');
    if (waived.length > 0) {
      throw new BadRequestException(
        `${waived.length} charge(s) have been waived or cancelled and cannot be billed for.`,
      );
    }

    const subtotal = charges.reduce((sum, charge) => sum + charge.amountMinor, 0n);
    const discount = BigInt(input.discountMinor);

    if (discount > subtotal) {
      throw new BadRequestException(
        'The discount is larger than the invoice. A negative total is not a bill; it is a refund, and ' +
          'it has its own path.',
      );
    }

    const context = tryGetContext();
    const count = await this.prisma.invoice.count({ where: { organisationId } });
    const reference = `INV-${String(count + 1).padStart(7, '0')}`;

    const invoice = await this.prisma.$transaction(async (tx) => {
      const row = await tx.invoice.create({
        data: {
          id: randomUUID(),
          organisationId,
          facilityId: input.facilityId,
          patientId: input.patientId,
          reference,
          payerType: input.payerType,
          payerName: input.payerName,
          status: 'ISSUED',
          issuedAt: this.now(),
          dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
          subtotalMinor: subtotal,
          discountMinor: discount,
          totalMinor: subtotal - discount,
          paidMinor: 0n,
          createdBy: context?.userId,
          items: {
            create: charges.map((charge) => ({
              chargeId: charge.id,
              organisationId,
              facilityId: input.facilityId,
              description: charge.description,
              quantity: charge.quantity,
              unitPriceMinor: charge.unitPriceMinor,
              amountMinor: charge.amountMinor,
            })),
          },
        },
        select: {
          id: true,
          reference: true,
          subtotalMinor: true,
          discountMinor: true,
          totalMinor: true,
          status: true,
          issuedAt: true,
        },
      });

      await tx.charge.updateMany({
        where: { id: { in: input.chargeIds } },
        data: { status: 'INVOICED' },
      });

      return row;
    });

    await this.audit.record({
      action: 'billing.invoice',
      entityType: 'invoice',
      entityId: invoice.id,
      facilityId: input.facilityId,
      newValue: { reference, totalMinor: invoice.totalMinor.toString(), charges: charges.length },
    });

    return {
      ...invoice,
      subtotalMinor: Number(invoice.subtotalMinor),
      discountMinor: Number(invoice.discountMinor),
      totalMinor: Number(invoice.totalMinor),
    };
  }

  async listInvoices(facilityId: string) {
    this.assertFacilityVisible(facilityId);

    const invoices = await this.prisma.invoice.findMany({
      where: { facilityId },
      orderBy: { issuedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        reference: true,
        payerType: true,
        status: true,
        issuedAt: true,
        dueDate: true,
        totalMinor: true,
        paidMinor: true,
        items: { select: { description: true, amountMinor: true } },
      },
    });

    const today = this.now();

    return invoices.map((invoice) => ({
      id: invoice.id,
      reference: invoice.reference,
      payerType: invoice.payerType,
      status: invoice.status,
      issuedAt: invoice.issuedAt,
      dueDate: invoice.dueDate,
      totalMinor: Number(invoice.totalMinor),
      paidMinor: Number(invoice.paidMinor),
      // Derived on read, never stored: an invoice becomes overdue because a
      // date passed, not because something ran (§10).
      outstandingMinor: Number(invoice.totalMinor - invoice.paidMinor),
      overdue: Boolean(
        invoice.dueDate && invoice.dueDate < today && invoice.totalMinor > invoice.paidMinor,
      ),
      lines: invoice.items.map((item) => ({
        description: item.description,
        amountMinor: Number(item.amountMinor),
      })),
    }));
  }

  // ---------------------------------------------------------------------------
  // Payments
  // ---------------------------------------------------------------------------

  async receivePayment(input: ReceivePayment) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const allocated = input.allocations.reduce((sum, allocation) => sum + allocation.amountMinor, 0);

    if (allocated > input.amountMinor) {
      throw new BadRequestException(
        `The allocations total ${allocated} kobo against a payment of ${input.amountMinor} kobo. ` +
          'Money cannot be applied twice.',
      );
    }

    const invoiceIds = input.allocations.map((allocation) => allocation.invoiceId);
    if (new Set(invoiceIds).size !== invoiceIds.length) {
      throw new BadRequestException(
        'The same invoice appears twice in the allocations. Combine them into one line, so the ' +
          'receipt says one thing about each invoice.',
      );
    }

    const invoices = await this.prisma.invoice.findMany({
      where: { id: { in: invoiceIds }, facilityId: input.facilityId },
      select: { id: true, reference: true, totalMinor: true, paidMinor: true, status: true },
    });

    if (invoices.length !== invoiceIds.length) {
      throw new NotFoundException('One or more invoices do not exist at this facility.');
    }

    for (const allocation of input.allocations) {
      const invoice = invoices.find((candidate) => candidate.id === allocation.invoiceId)!;
      const outstanding = invoice.totalMinor - invoice.paidMinor;

      if (invoice.status === 'CANCELLED') {
        throw new BadRequestException(`Invoice ${invoice.reference} is cancelled and cannot be paid.`);
      }

      if (BigInt(allocation.amountMinor) > outstanding) {
        throw new BadRequestException(
          `Invoice ${invoice.reference} has ${outstanding} kobo outstanding and the allocation is ` +
            `${allocation.amountMinor}. Overpaying an invoice hides money that belongs somewhere else; ` +
            'record the excess as unallocated, or refund it.',
        );
      }
    }

    const context = tryGetContext();
    const count = await this.prisma.payment.count({ where: { organisationId } });
    const reference = `PAY-${String(count + 1).padStart(7, '0')}`;
    const receivedAt = this.now();

    const payment = await this.prisma.$transaction(async (tx) => {
      const row = await tx.payment.create({
        data: {
          id: randomUUID(),
          organisationId,
          facilityId: input.facilityId,
          reference,
          direction: 'INBOUND',
          amountMinor: BigInt(input.amountMinor),
          method: input.method,
          externalReference: input.externalReference,
          receivedBy: context?.userId,
          receivedAt,
          notes: input.notes,
          createdBy: context?.userId,
          allocations: {
            create: input.allocations.map((allocation) => ({
              invoiceId: allocation.invoiceId,
              organisationId,
              amountMinor: BigInt(allocation.amountMinor),
              allocatedBy: context?.userId,
            })),
          },
        },
        select: { id: true, reference: true, amountMinor: true, method: true, receivedAt: true },
      });

      for (const allocation of input.allocations) {
        const invoice = invoices.find((candidate) => candidate.id === allocation.invoiceId)!;
        const paid = invoice.paidMinor + BigInt(allocation.amountMinor);

        await tx.invoice.update({
          where: { id: invoice.id },
          data: {
            paidMinor: paid,
            // Derived from the arithmetic, not chosen: an invoice is paid when
            // the money equals the total, and partly paid when it does not.
            status: paid >= invoice.totalMinor ? 'PAID' : 'PARTIALLY_PAID',
            version: { increment: 1 },
          },
        });
      }

      // Settles the receivable. No revenue is recognised here; it was
      // recognised when the charge was raised.
      await this.finance.post(
        postPatientPayment({
          paymentId: row.id,
          amountMinor: input.amountMinor,
          method: input.method,
          description: reference,
        }),
        { facilityId: input.facilityId, entryDate: receivedAt },
        tx,
      );

      return row;
    });

    await this.audit.record({
      action: 'payment.receive',
      entityType: 'payment',
      entityId: payment.id,
      facilityId: input.facilityId,
      newValue: {
        reference,
        amountMinor: input.amountMinor,
        method: input.method,
        allocations: input.allocations.length,
      },
      severity: 'NOTICE',
    });

    return {
      ...payment,
      amountMinor: Number(payment.amountMinor),
      allocatedMinor: allocated,
      unallocatedMinor: input.amountMinor - allocated,
      // Said out loud: money received against nothing in particular is money
      // somebody will have to explain later.
      unallocatedNote:
        input.amountMinor - allocated > 0
          ? 'Part of this payment is not allocated to any invoice. It is recorded as received and will ' +
            'appear as unallocated until somebody says what it settles.'
          : undefined,
    };
  }
}
