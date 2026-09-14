import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CreateGoodsReceipt,
  CreatePurchaseOrder,
  CreatePurchaseRequest,
  CreateQuotation,
  CreateSupplier,
  CreateSupplierInvoice,
} from '@chc/contracts';

import { BusinessRuleError, ReasonRequiredError, SegregationOfDutiesError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ConfigService } from '../config/config.service';

import {
  DEFAULT_TOLERANCE,
  matchInvoice,
  type MatchOrderLine,
  type MatchReceiptLine,
  type MatchTolerance,
} from './domain/three-way-match';

/**
 * Procurement (spec §46, doc 14 §7).
 *
 *   request -> approval -> quotations -> order -> receipt -> invoice -> payment
 *
 * Two controls this module exists to hold, both acceptance criteria:
 *
 *  - A capital line received becomes an ASSET; a consumable line becomes stock.
 *    Never both, never neither (criterion E).
 *  - An invoice with no goods receipt behind it cannot be paid. The three-way
 *    match decides, and the database refuses the payment regardless of caller.
 */
@Injectable()
export class ProcurementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
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
  // Suppliers
  // ---------------------------------------------------------------------------

  async createSupplier(input: CreateSupplier) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const count = await this.prisma.supplier.count({ where: { organisationId } });

    const supplier = await this.prisma.supplier.create({
      data: {
        organisationId,
        code: `SUP-${String(count + 1).padStart(4, '0')}`,
        name: input.name,
        contactPerson: input.contactName,
        email: input.contactEmail,
        phone: input.contactPhone,
        address: input.address,
        taxId: input.taxIdentifier,
        createdBy: context?.userId,
      },
      select: { id: true, code: true, name: true, status: true },
    });

    await this.audit.record({
      action: 'procurement.supplier.create',
      entityType: 'supplier',
      entityId: supplier.id,
      newValue: { code: supplier.code, name: supplier.name },
    });

    return supplier;
  }

  // ---------------------------------------------------------------------------
  // Request and approval
  // ---------------------------------------------------------------------------

  async createRequest(input: CreatePurchaseRequest) {
    const { organisationId } = getTenantScope();
    this.assertFacilityVisible(input.facilityId);

    const context = tryGetContext();
    const reference = await this.nextReference(organisationId, 'purchaseRequest', 'PR');

    const request = await this.prisma.purchaseRequest.create({
      data: {
        id: input.id ?? randomUUID(),
        organisationId,
        facilityId: input.facilityId,
        projectId: input.projectId,
        reference,
        title: input.title,
        justification: input.justification,
        status: 'SUBMITTED',
        requestedBy: context?.userId,
        requestedAt: this.now(),
        createdBy: context?.userId,
        lines: {
          create: input.lines.map((line) => ({
            organisationId,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            estimatedUnitCostMinor:
              line.estimatedUnitCostMinor !== undefined ? BigInt(line.estimatedUnitCostMinor) : undefined,
            isCapitalItem: line.isCapitalItem,
          })),
        },
      },
      select: { id: true, reference: true, title: true, status: true },
    });

    await this.audit.record({
      action: 'procurement.request.create',
      entityType: 'purchase_request',
      entityId: request.id,
      facilityId: input.facilityId,
      newValue: { reference, lines: input.lines.length },
    });

    return { ...request, lineCount: input.lines.length };
  }

  /** The requester may not approve their own request (doc 18 §9). */
  async decideRequest(requestId: string, input: { decision: 'APPROVED' | 'REJECTED'; reason?: string }) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const request = await this.prisma.purchaseRequest.findFirst({
      where: { id: requestId, organisationId },
      select: { id: true, reference: true, facilityId: true, status: true, requestedBy: true, createdBy: true },
    });

    if (!request) throw new NotFoundException('No such purchase request, or it is not visible to you.');
    this.assertFacilityVisible(request.facilityId);

    if (request.status !== 'SUBMITTED') {
      throw new BadRequestException(`${request.reference} is ${request.status} and is not awaiting a decision.`);
    }

    const requester = request.requestedBy ?? request.createdBy;
    if (requester && context?.userId && requester === context.userId) {
      throw new SegregationOfDutiesError('The requester may not approve the purchase order.');
    }

    if (input.decision === 'REJECTED' && (input.reason ?? '').trim().length < 10) {
      throw new ReasonRequiredError('Rejecting a purchase request');
    }

    const updated = await this.prisma.purchaseRequest.update({
      where: { id: request.id },
      data: {
        status: input.decision,
        approvedBy: input.decision === 'APPROVED' ? context?.userId : undefined,
        approvedAt: input.decision === 'APPROVED' ? this.now() : undefined,
        rejectionReason: input.decision === 'REJECTED' ? input.reason : undefined,
        updatedBy: context?.userId,
      },
      select: { id: true, reference: true, status: true, approvedAt: true },
    });

    await this.audit.record({
      action: 'procurement.request.decide',
      entityType: 'purchase_request',
      entityId: request.id,
      facilityId: request.facilityId,
      oldValue: { status: request.status },
      newValue: { status: input.decision },
      reason: input.reason,
      severity: 'NOTICE',
    });

    return updated;
  }

  // ---------------------------------------------------------------------------
  // Quotations
  // ---------------------------------------------------------------------------

  async addQuotation(input: CreateQuotation) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const request = await this.prisma.purchaseRequest.findFirst({
      where: { id: input.purchaseRequestId, organisationId },
      select: { id: true, facilityId: true, status: true, reference: true },
    });

    if (!request) throw new NotFoundException('No such purchase request.');
    this.assertFacilityVisible(request.facilityId);

    if (request.status !== 'APPROVED' && request.status !== 'QUOTING') {
      throw new BadRequestException(
        `${request.reference} is ${request.status}. Quotations are collected after a request is approved.`,
      );
    }

    const total = input.lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unitPriceMinor), 0);

    const quotation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.quotation.create({
        data: {
          purchaseRequestId: request.id,
          supplierId: input.supplierId,
          organisationId,
          reference: input.reference,
          receivedOn: this.now(),
          validUntil: input.validUntil ? new Date(input.validUntil) : undefined,
          totalMinor: BigInt(total),
          createdBy: context?.userId,
          lines: {
            create: input.lines.map((line) => ({
              organisationId,
              description: line.description,
              quantity: line.quantity,
              unitPriceMinor: BigInt(line.unitPriceMinor),
              lineTotalMinor: BigInt(Math.round(line.quantity * line.unitPriceMinor)),
            })),
          },
        },
        select: { id: true, totalMinor: true, supplierId: true },
      });

      await tx.purchaseRequest.update({ where: { id: request.id }, data: { status: 'QUOTING' } });

      return created;
    });

    await this.audit.record({
      action: 'procurement.quotation.add',
      entityType: 'quotation',
      entityId: quotation.id,
      facilityId: request.facilityId,
      newValue: { supplierId: input.supplierId, totalMinor: total },
    });

    return { ...quotation, totalMinor: quotation.totalMinor.toString() };
  }

  /**
   * Choose a supplier.
   *
   * Choosing other than the cheapest requires a reason. That is not
   * bureaucracy: it is exactly what a procurement audit looks for, and the
   * honest answers — better warranty, only supplier who can deliver in time —
   * are easy to give at the moment of choosing and impossible to reconstruct
   * a year later.
   */
  async selectQuotation(quotationId: string, input: { selectionReason?: string }) {
    const { organisationId } = getTenantScope();

    const quotation = await this.prisma.quotation.findFirst({
      where: { id: quotationId, organisationId },
      select: {
        id: true,
        totalMinor: true,
        purchaseRequestId: true,
        purchaseRequest: { select: { id: true, facilityId: true, reference: true } },
      },
    });

    if (!quotation) throw new NotFoundException('No such quotation.');
    this.assertFacilityVisible(quotation.purchaseRequest.facilityId);

    const all = await this.prisma.quotation.findMany({
      where: { purchaseRequestId: quotation.purchaseRequestId },
      select: { id: true, totalMinor: true, supplier: { select: { name: true } } },
      orderBy: { totalMinor: 'asc' },
    });

    const cheapest = all[0];
    const isCheapest = cheapest.id === quotation.id;

    if (!isCheapest && (input.selectionReason ?? '').trim().length < 10) {
      throw new ReasonRequiredError(
        `Selecting a quotation of ${quotation.totalMinor} when ${cheapest.supplier.name} quoted ${cheapest.totalMinor}`,
      );
    }

    await this.prisma.$transaction([
      this.prisma.quotation.updateMany({
        where: { purchaseRequestId: quotation.purchaseRequestId },
        data: { isSelected: false },
      }),
      this.prisma.quotation.update({
        where: { id: quotation.id },
        data: { isSelected: true, selectionReason: input.selectionReason },
      }),
    ]);

    await this.audit.record({
      action: 'procurement.quotation.select',
      entityType: 'quotation',
      entityId: quotation.id,
      facilityId: quotation.purchaseRequest.facilityId,
      newValue: {
        selected: quotation.totalMinor.toString(),
        cheapest: cheapest.totalMinor.toString(),
        wasCheapest: isCheapest,
        quotationsConsidered: all.length,
      },
      reason: input.selectionReason,
      severity: 'NOTICE',
    });

    return {
      quotationId: quotation.id,
      totalMinor: quotation.totalMinor.toString(),
      wasCheapest: isCheapest,
      quotationsConsidered: all.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Purchase order
  // ---------------------------------------------------------------------------

  async createOrder(input: CreatePurchaseOrder) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const quotation = await this.prisma.quotation.findFirst({
      where: { id: input.quotationId, organisationId, purchaseRequestId: input.purchaseRequestId },
      select: {
        id: true,
        isSelected: true,
        supplierId: true,
        totalMinor: true,
        lines: { select: { description: true, quantity: true, unitPriceMinor: true } },
        purchaseRequest: {
          select: {
            id: true,
            facilityId: true,
            projectId: true,
            reference: true,
            status: true,
            lines: { select: { description: true, isCapitalItem: true } },
          },
        },
      },
    });

    if (!quotation) throw new NotFoundException('No such quotation for that request.');
    this.assertFacilityVisible(quotation.purchaseRequest.facilityId);

    if (!quotation.isSelected) {
      throw new BadRequestException(
        'This quotation has not been selected. Select it, with a reason if it is not the cheapest, before ordering.',
      );
    }

    // Whether a line is capital travels from the request, where somebody
    // decided it, rather than being re-judged here. It determines whether
    // receipt creates an asset or stock (criterion E).
    const capitalByDescription = new Map(
      quotation.purchaseRequest.lines.map((line) => [line.description.toLowerCase(), line.isCapitalItem]),
    );

    const reference = await this.nextReference(organisationId, 'purchaseOrder', 'PO');

    const order = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchaseOrder.create({
        data: {
          purchaseRequestId: quotation.purchaseRequest.id,
          supplierId: quotation.supplierId,
          organisationId,
          facilityId: quotation.purchaseRequest.facilityId,
          projectId: quotation.purchaseRequest.projectId,
          reference,
          orderedOn: new Date(input.orderedOn),
          expectedDelivery: input.expectedDelivery ? new Date(input.expectedDelivery) : undefined,
          totalMinor: quotation.totalMinor,
          terms: input.terms,
          issuedBy: context?.userId,
          createdBy: context?.userId,
          lines: {
            create: quotation.lines.map((line) => ({
              organisationId,
              description: line.description,
              quantityOrdered: line.quantity,
              unitPriceMinor: line.unitPriceMinor,
              lineTotalMinor: BigInt(Math.round(Number(line.quantity) * Number(line.unitPriceMinor))),
              isCapitalItem: capitalByDescription.get(line.description.toLowerCase()) ?? false,
            })),
          },
        },
        select: {
          id: true,
          reference: true,
          status: true,
          totalMinor: true,
          lines: { select: { id: true, description: true, quantityOrdered: true, isCapitalItem: true } },
        },
      });

      await tx.purchaseRequest.update({
        where: { id: quotation.purchaseRequest.id },
        data: { status: 'ORDERED' },
      });

      return created;
    });

    await this.audit.record({
      action: 'procurement.order.create',
      entityType: 'purchase_order',
      entityId: order.id,
      facilityId: quotation.purchaseRequest.facilityId,
      newValue: { reference, supplierId: quotation.supplierId, totalMinor: order.totalMinor.toString() },
      severity: 'NOTICE',
    });

    return {
      ...order,
      totalMinor: order.totalMinor.toString(),
      lines: order.lines.map((line) => ({ ...line, quantityOrdered: Number(line.quantityOrdered) })),
    };
  }

  // ---------------------------------------------------------------------------
  // Goods receipt — the fork in the road (criterion E)
  // ---------------------------------------------------------------------------

  /**
   * Receive goods.
   *
   * Each accepted line goes one way or the other: a capital line creates an
   * EquipmentAsset per unit, a consumable line creates an inventory batch.
   * Never both, never neither. An asset created here starts at RECEIVED — it
   * exists, and it is explicitly not yet available for use.
   */
  async receiveGoods(input: CreateGoodsReceipt) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, organisationId },
      select: {
        id: true,
        reference: true,
        facilityId: true,
        status: true,
        supplierId: true,
        orderedOn: true,
        lines: { select: { id: true, description: true, quantityOrdered: true, unitPriceMinor: true, isCapitalItem: true } },
      },
    });

    if (!order) throw new NotFoundException('No such purchase order, or it is not visible to you.');
    this.assertFacilityVisible(order.facilityId);

    if (order.status === 'CANCELLED') {
      throw new BadRequestException(`${order.reference} was cancelled; goods cannot be received against it.`);
    }

    for (const line of input.lines) {
      const accounted = line.quantityAccepted + line.quantityRejected;

      // The database enforces this too. Here it earns a message somebody can act on.
      if (Math.abs(accounted - line.quantityReceived) > 1e-9) {
        throw new BadRequestException(
          `"${line.description}": ${line.quantityReceived} received but ${accounted} accounted for ` +
            `(${line.quantityAccepted} accepted, ${line.quantityRejected} rejected). Every unit must be one or the other.`,
        );
      }

      if (line.quantityRejected > 0 && (line.rejectionReason ?? '').trim().length < 5) {
        throw new ReasonRequiredError(`Rejecting ${line.quantityRejected} of "${line.description}"`);
      }

      if (line.isCapitalItem && line.serialNumbers.length > 0 && line.serialNumbers.length !== Math.round(line.quantityAccepted)) {
        throw new BadRequestException(
          `"${line.description}": ${line.quantityAccepted} accepted but ${line.serialNumbers.length} serial number(s) given. ` +
            'Give one per unit, or none at all.',
        );
      }
    }

    const reference = await this.nextReference(organisationId, 'goodsReceipt', 'GRN');
    const createdAssets: Array<{ id: string; assetTag: string; name: string }> = [];

    const receipt = await this.prisma.$transaction(async (tx) => {
      const grn = await tx.goodsReceipt.create({
        data: {
          id: input.id ?? randomUUID(),
          purchaseOrderId: order.id,
          organisationId,
          facilityId: order.facilityId,
          reference,
          receivedOn: new Date(input.receivedOn),
          receivedBy: context?.userId,
          deliveryNoteRef: input.deliveryNoteRef,
          inspectionNote: input.inspectionNote,
          createdBy: context?.userId,
        },
        select: { id: true, reference: true, receivedOn: true },
      });

      let assetSequence = await tx.equipmentAsset.count({ where: { facilityId: order.facilityId } });

      for (const line of input.lines) {
        const grnLine = await tx.goodsReceiptLine.create({
          data: {
            goodsReceiptId: grn.id,
            purchaseOrderLineId: line.purchaseOrderLineId,
            organisationId,
            facilityId: order.facilityId,
            description: line.description,
            quantityReceived: line.quantityReceived,
            quantityAccepted: line.quantityAccepted,
            quantityRejected: line.quantityRejected,
            rejectionReason: line.rejectionReason,
            unitCostMinor: BigInt(line.unitCostMinor),
            batchNumber: line.batchNumber,
            expiryDate: line.expiryDate ? new Date(line.expiryDate) : undefined,
            isCapitalItem: line.isCapitalItem,
          },
          select: { id: true },
        });

        if (!line.isCapitalItem || line.quantityAccepted <= 0) continue;

        // One asset per unit. Assets are tracked, maintained, commissioned and
        // eventually disposed of individually; a row saying "4 beds" cannot
        // record that one of them is broken.
        const units = Math.round(line.quantityAccepted);

        for (let index = 0; index < units; index += 1) {
          assetSequence += 1;
          const assetTag = `AST-${String(assetSequence).padStart(5, '0')}`;

          const asset = await tx.equipmentAsset.create({
            data: {
              facilityId: order.facilityId,
              organisationId,
              goodsReceiptLineId: grnLine.id,
              assetTag,
              name: line.description,
              category: 'EQUIPMENT',
              serialNumber: line.serialNumbers[index],
              purchaseDate: new Date(input.receivedOn),
              costMinor: BigInt(line.unitCostMinor),
              // It exists and it is explicitly not yet usable. Nothing counts
              // toward service readiness until it is commissioned.
              commissioningStatus: 'RECEIVED',
              classification: 'ACTUAL',
              createdBy: context?.userId,
            },
            select: { id: true, assetTag: true, name: true },
          });

          createdAssets.push(asset);
        }
      }

      const fullyReceived = await this.isFullyReceived(tx, order.id, order.lines);

      await tx.purchaseOrder.update({
        where: { id: order.id },
        data: { status: fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED' },
      });

      return grn;
    });

    await this.audit.record({
      action: 'procurement.receipt.create',
      entityType: 'goods_receipt',
      entityId: receipt.id,
      facilityId: order.facilityId,
      newValue: {
        reference,
        lines: input.lines.length,
        assetsCreated: createdAssets.length,
        rejected: input.lines.reduce((sum, line) => sum + line.quantityRejected, 0),
      },
      severity: 'NOTICE',
    });

    return {
      ...receipt,
      assetsCreated: createdAssets,
      note:
        createdAssets.length > 0
          ? `${createdAssets.length} asset(s) were created and are RECEIVED. They do not count toward service ` +
            'readiness until every commissioning check passes.'
          : 'No capital items were on this receipt, so no assets were created.',
    };
  }

  // ---------------------------------------------------------------------------
  // Invoice and the three-way match
  // ---------------------------------------------------------------------------

  async recordInvoice(input: CreateSupplierInvoice) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();

    const order = await this.prisma.purchaseOrder.findFirst({
      where: { id: input.purchaseOrderId, organisationId },
      select: { id: true, reference: true, facilityId: true, supplierId: true },
    });

    if (!order) throw new NotFoundException('No such purchase order.');
    this.assertFacilityVisible(order.facilityId);

    if (order.supplierId !== input.supplierId) {
      throw new BadRequestException(
        `${order.reference} was placed with a different supplier. An invoice must come from the supplier who was ordered from.`,
      );
    }

    const match = await this.evaluateMatch(order.id, {
      invoiceNumber: input.invoiceNumber,
      amountMinor: input.amountMinor,
      taxMinor: input.taxMinor,
      totalMinor: input.totalMinor,
    });

    const invoice = await this.prisma.supplierInvoice.create({
      data: {
        supplierId: input.supplierId,
        purchaseOrderId: order.id,
        organisationId,
        facilityId: order.facilityId,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: new Date(input.invoiceDate),
        dueDate: input.dueDate ? new Date(input.dueDate) : undefined,
        amountMinor: BigInt(input.amountMinor),
        taxMinor: BigInt(input.taxMinor),
        totalMinor: BigInt(input.totalMinor),
        matchStatus: match.status === 'MATCHED' ? 'MATCHED' : match.status === 'VARIANCE' ? 'VARIANCE' : 'BLOCKED',
        matchVarianceNote:
          match.findings.length > 0 ? match.findings.map((finding) => finding.detail).join(' ') : undefined,
        createdBy: context?.userId,
      },
      select: { id: true, invoiceNumber: true, matchStatus: true, totalMinor: true },
    });

    await this.audit.record({
      action: 'procurement.invoice.record',
      entityType: 'supplier_invoice',
      entityId: invoice.id,
      facilityId: order.facilityId,
      newValue: { invoiceNumber: input.invoiceNumber, matchStatus: invoice.matchStatus, findings: match.findings.length },
      severity: match.status === 'BLOCKED' ? 'NOTICE' : 'INFO',
    });

    return {
      ...invoice,
      totalMinor: invoice.totalMinor.toString(),
      match,
    };
  }

  /** The match, recomputed from the current records rather than read from a cache. */
  async matchStatus(invoiceId: string) {
    const invoice = await this.loadInvoice(invoiceId);

    const match = await this.evaluateMatch(
      invoice.purchaseOrderId!,
      {
        invoiceNumber: invoice.invoiceNumber,
        amountMinor: Number(invoice.amountMinor),
        taxMinor: Number(invoice.taxMinor),
        totalMinor: Number(invoice.totalMinor),
      },
      { excludeInvoiceId: invoice.id, paidToDateMinor: invoice.paidToDateMinor },
    );

    return { invoiceId: invoice.id, invoiceNumber: invoice.invoiceNumber, ...match };
  }

  /**
   * Pay a supplier invoice.
   *
   * Refused whenever the match is blocked. This is the acceptance criterion:
   * an invoice with no goods receipt behind it cannot be paid — here with an
   * explanation, and in the database regardless of who is calling.
   */
  async raisePayment(
    invoiceId: string,
    input: {
      amountMinor: number;
      method: string;
      paidOn?: string;
      externalReference?: string;
      varianceApprovalReason?: string;
    },
  ) {
    const { organisationId } = getTenantScope();
    const context = tryGetContext();
    const invoice = await this.loadInvoice(invoiceId);

    const match = await this.evaluateMatch(
      invoice.purchaseOrderId!,
      {
        invoiceNumber: invoice.invoiceNumber,
        amountMinor: Number(invoice.amountMinor),
        taxMinor: Number(invoice.taxMinor),
        totalMinor: Number(invoice.totalMinor),
      },
      { excludeInvoiceId: invoice.id, paidToDateMinor: invoice.paidToDateMinor },
    );

    if (match.status === 'BLOCKED') {
      await this.audit.record({
        action: 'procurement.payment.raise',
        entityType: 'supplier_invoice',
        entityId: invoice.id,
        facilityId: invoice.facilityId,
        outcome: 'DENIED',
        newValue: { reason: match.findings.map((finding) => finding.code) },
        severity: 'WARNING',
      });

      throw new BusinessRuleError(
        'three-way-match-failed',
        'Payment blocked by the three-way match',
        match.findings
          .filter((finding) => finding.severity === 'BLOCK')
          .map((finding) => `${finding.detail} ${finding.remedy}`)
          .join(' '),
        409,
        { findings: match.findings },
      );
    }

    if (match.requiresApproval && (input.varianceApprovalReason ?? '').trim().length < 10) {
      throw new ReasonRequiredError('Paying an invoice with an unresolved variance');
    }

    if (input.amountMinor > match.payableMinor) {
      throw new BusinessRuleError(
        'duplicate-payment',
        'Payment exceeds what is payable',
        `${input.amountMinor} was requested but only ${match.payableMinor} remains payable on this invoice.`,
        409,
        { payableMinor: match.payableMinor },
      );
    }

    // Raised, not yet released. The approver is deliberately left null: the
    // person raising an outbound payment may not approve it (doc 18 §9), and
    // filling it in here would make that rule decorative.
    const paidOn = input.paidOn ? new Date(input.paidOn) : this.now();
    const count = await this.prisma.payment.count({ where: { organisationId } });

    const payment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          organisationId,
          facilityId: invoice.facilityId,
          reference: `PAY-${String(count + 1).padStart(6, '0')}`,
          direction: 'OUTBOUND',
          amountMinor: BigInt(input.amountMinor),
          method: input.method as never,
          externalReference: input.externalReference,
          supplierInvoiceId: invoice.id,
          receivedAt: paidOn,
          createdBy: context?.userId,
        },
        select: { id: true, reference: true, amountMinor: true, receivedAt: true },
      });

      await tx.supplierInvoice.update({
        where: { id: invoice.id },
        data: { matchStatus: match.status === 'VARIANCE' ? 'VARIANCE' : 'MATCHED' },
      });

      return created;
    });

    await this.audit.record({
      action: 'procurement.payment.raise',
      entityType: 'payment',
      entityId: payment.id,
      facilityId: invoice.facilityId,
      newValue: {
        invoiceNumber: invoice.invoiceNumber,
        amountMinor: input.amountMinor,
        matchStatus: match.status,
        varianceApproved: match.requiresApproval,
      },
      reason: input.varianceApprovalReason,
      severity: 'NOTICE',
    });

    return {
      paymentId: payment.id,
      reference: payment.reference,
      amountMinor: payment.amountMinor.toString(),
      remainingMinor: (match.payableMinor - input.amountMinor).toString(),
      matchStatus: match.status,
      approved: false,
      note: 'Raised and awaiting approval. Nothing leaves the facility until a second person approves it.',
    };
  }

  /**
   * Release a raised payment.
   *
   * The person who raised it may not approve it. That is the oldest control in
   * accounts payable, and the reason a single compromised account cannot move
   * money out of a facility on its own.
   */
  async approvePayment(paymentId: string, input: { note?: string }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, organisationId, direction: 'OUTBOUND' },
      select: {
        id: true,
        reference: true,
        facilityId: true,
        amountMinor: true,
        createdBy: true,
        approvedBy: true,
        supplierInvoiceId: true,
        supplierInvoice: { select: { id: true, invoiceNumber: true, totalMinor: true, purchaseOrderId: true } },
      },
    });

    if (!payment || !facilityIds.includes(payment.facilityId)) {
      throw new NotFoundException('No such outbound payment, or it is not visible to you.');
    }

    if (payment.approvedBy) {
      throw new BadRequestException(`${payment.reference} has already been approved.`);
    }

    if (payment.createdBy && context?.userId && payment.createdBy === context.userId) {
      throw new SegregationOfDutiesError('The person who raises a payment may not approve it.');
    }

    const approvedAt = this.now();

    await this.prisma.$transaction(async (tx) => {
      await tx.payment.update({
        where: { id: payment.id },
        data: { approvedBy: context?.userId, approvedAt },
      });

      if (payment.supplierInvoice?.purchaseOrderId) {
        const approved = await tx.payment.aggregate({
          where: { supplierInvoiceId: payment.supplierInvoiceId, approvedBy: { not: null } },
          _sum: { amountMinor: true },
        });

        if ((approved._sum.amountMinor ?? 0n) >= payment.supplierInvoice.totalMinor) {
          await tx.purchaseOrder.update({
            where: { id: payment.supplierInvoice.purchaseOrderId },
            data: { status: 'PAID' },
          });
        }
      }
    });

    await this.audit.record({
      action: 'procurement.payment.approve',
      entityType: 'payment',
      entityId: payment.id,
      facilityId: payment.facilityId,
      newValue: {
        reference: payment.reference,
        amountMinor: payment.amountMinor.toString(),
        invoiceNumber: payment.supplierInvoice?.invoiceNumber ?? null,
      },
      reason: input.note,
      severity: 'CRITICAL',
    });

    return {
      paymentId: payment.id,
      reference: payment.reference,
      approved: true,
      approvedAt,
      amountMinor: payment.amountMinor.toString(),
    };
  }

  // ---------------------------------------------------------------------------

  private async evaluateMatch(
    purchaseOrderId: string,
    invoice: { invoiceNumber: string; amountMinor: number; taxMinor: number; totalMinor: number },
    options: { excludeInvoiceId?: string; paidToDateMinor?: number } = {},
  ) {
    const order = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: {
        id: true,
        facilityId: true,
        supplierId: true,
        lines: { select: { id: true, description: true, quantityOrdered: true, unitPriceMinor: true } },
      },
    });

    if (!order) throw new NotFoundException('No such purchase order.');

    const receipts = await this.prisma.goodsReceiptLine.findMany({
      where: { goodsReceipt: { purchaseOrderId } },
      select: {
        purchaseOrderLineId: true,
        description: true,
        quantityAccepted: true,
        quantityRejected: true,
        unitCostMinor: true,
      },
    });

    const others = await this.prisma.supplierInvoice.findMany({
      where: {
        supplierId: order.supplierId,
        ...(options.excludeInvoiceId ? { id: { not: options.excludeInvoiceId } } : {}),
      },
      select: { invoiceNumber: true },
    });

    const orderLines: MatchOrderLine[] = order.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantityOrdered: Number(line.quantityOrdered),
      unitPriceMinor: Number(line.unitPriceMinor),
    }));

    const receiptLines: MatchReceiptLine[] = receipts.map((line) => ({
      purchaseOrderLineId: line.purchaseOrderLineId,
      description: line.description,
      quantityAccepted: Number(line.quantityAccepted),
      quantityRejected: Number(line.quantityRejected),
      unitCostMinor: Number(line.unitCostMinor),
    }));

    const tolerance = await this.config.json<MatchTolerance>(
      'procurement.matchTolerance',
      DEFAULT_TOLERANCE,
      order.facilityId,
    );

    return matchInvoice({
      orderLines,
      receiptLines,
      invoice,
      existingInvoiceNumbers: others.map((other) => other.invoiceNumber),
      paidToDateMinor: options.paidToDateMinor ?? 0,
      tolerance,
    });
  }

  private async loadInvoice(invoiceId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    const invoice = await this.prisma.supplierInvoice.findFirst({
      where: { id: invoiceId, organisationId },
      select: {
        id: true,
        facilityId: true,
        invoiceNumber: true,
        amountMinor: true,
        taxMinor: true,
        totalMinor: true,
        matchStatus: true,
        purchaseOrderId: true,
        payments: { select: { amountMinor: true } },
      },
    });

    if (!invoice || !facilityIds.includes(invoice.facilityId)) {
      throw new NotFoundException('No such supplier invoice, or it is not visible to you.');
    }

    if (!invoice.purchaseOrderId) {
      throw new BadRequestException(
        `Invoice ${invoice.invoiceNumber} cites no purchase order, so it cannot be matched or paid.`,
      );
    }

    return {
      ...invoice,
      paidToDateMinor: invoice.payments.reduce((sum, payment) => sum + Number(payment.amountMinor), 0),
    };
  }

  private async isFullyReceived(
    tx: Parameters<Parameters<PrismaService['$transaction']>[0]>[0],
    purchaseOrderId: string,
    lines: ReadonlyArray<{ id: string; quantityOrdered: unknown }>,
  ): Promise<boolean> {
    const received = await tx.goodsReceiptLine.groupBy({
      by: ['purchaseOrderLineId'],
      where: { goodsReceipt: { purchaseOrderId } },
      _sum: { quantityAccepted: true },
    });

    const acceptedByLine = new Map(
      received.map((row) => [row.purchaseOrderLineId, Number(row._sum.quantityAccepted ?? 0)]),
    );

    return lines.every((line) => (acceptedByLine.get(line.id) ?? 0) >= Number(line.quantityOrdered));
  }

  private async nextReference(
    organisationId: string,
    entity: 'purchaseRequest' | 'purchaseOrder' | 'goodsReceipt',
    prefix: string,
  ): Promise<string> {
    const count =
      entity === 'purchaseRequest'
        ? await this.prisma.purchaseRequest.count({ where: { organisationId } })
        : entity === 'purchaseOrder'
          ? await this.prisma.purchaseOrder.count({ where: { organisationId } })
          : await this.prisma.goodsReceipt.count({ where: { organisationId } });

    return `${prefix}-${String(count + 1).padStart(5, '0')}`;
  }
}
