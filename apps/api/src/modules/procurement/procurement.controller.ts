import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  createGoodsReceiptSchema,
  createPurchaseOrderSchema,
  createPurchaseRequestSchema,
  createQuotationSchema,
  createSupplierInvoiceSchema,
  createSupplierSchema,
  decideRequestSchema,
  paySupplierInvoiceSchema,
  selectQuotationSchema,
  type CreateGoodsReceipt,
  type CreatePurchaseOrder,
  type CreatePurchaseRequest,
  type CreateQuotation,
  type CreateSupplier,
  type CreateSupplierInvoice,
} from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { ProcurementService } from './procurement.service';

const approvePaymentSchema = z.object({ note: z.string().max(1000).optional() });

@Controller({ path: 'procurement', version: '1' })
export class ProcurementController {
  constructor(private readonly procurement: ProcurementService) {}

  @Post('suppliers')
  @RequirePermission('procurement.request')
  @AuditAction('procurement.supplier.create')
  createSupplier(@Body(zodBody(createSupplierSchema)) body: CreateSupplier) {
    return this.procurement.createSupplier(body);
  }

  @Post('requests')
  @RequirePermission('procurement.request')
  @AuditAction('procurement.request.create')
  createRequest(@Body(zodBody(createPurchaseRequestSchema)) body: CreatePurchaseRequest) {
    return this.procurement.createRequest(body);
  }

  /** The requester may not approve their own request. */
  @Post('requests/:id/decide')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('procurement.approve')
  @AuditAction('procurement.request.decide')
  decideRequest(
    @Param('id') id: string,
    @Body(zodBody(decideRequestSchema)) body: z.infer<typeof decideRequestSchema>,
  ) {
    return this.procurement.decideRequest(id, body);
  }

  @Post('quotations')
  @RequirePermission('procurement.request')
  @AuditAction('procurement.quotation.add')
  addQuotation(@Body(zodBody(createQuotationSchema)) body: CreateQuotation) {
    return this.procurement.addQuotation(body);
  }

  /** Choosing other than the cheapest requires a reason. */
  @Post('quotations/:id/select')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('procurement.order')
  @AuditAction('procurement.quotation.select')
  selectQuotation(
    @Param('id') id: string,
    @Body(zodBody(selectQuotationSchema)) body: z.infer<typeof selectQuotationSchema>,
  ) {
    return this.procurement.selectQuotation(id, body);
  }

  @Post('orders')
  @RequirePermission('procurement.order')
  @AuditAction('procurement.order.create')
  createOrder(@Body(zodBody(createPurchaseOrderSchema)) body: CreatePurchaseOrder) {
    return this.procurement.createOrder(body);
  }

  /** A capital line becomes an asset; a consumable becomes stock. Criterion E. */
  @Post('receipts')
  @RequirePermission('procurement.receive')
  @AuditAction('procurement.receipt.create')
  receiveGoods(@Body(zodBody(createGoodsReceiptSchema)) body: CreateGoodsReceipt) {
    return this.procurement.receiveGoods(body);
  }

  @Post('invoices')
  @RequirePermission('procurement.receive')
  @AuditAction('procurement.invoice.record')
  recordInvoice(@Body(zodBody(createSupplierInvoiceSchema)) body: CreateSupplierInvoice) {
    return this.procurement.recordInvoice(body);
  }

  /** Recomputed from the current records, never read from a cached status. */
  @Get('invoices/:id/match')
  @RequirePermission('procurement.read')
  matchStatus(@Param('id') id: string) {
    return this.procurement.matchStatus(id);
  }

  /** Refused whenever the three-way match is blocked. Raises, does not release. */
  @Post('invoices/:id/pay')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payment.raise')
  @AuditAction('procurement.payment.raise')
  raisePayment(
    @Param('id') id: string,
    @Body(zodBody(paySupplierInvoiceSchema)) body: z.infer<typeof paySupplierInvoiceSchema>,
  ) {
    return this.procurement.raisePayment(id, body);
  }

  /** The person who raised a payment may not approve it. */
  @Post('payments/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('payment.approve')
  @AuditAction('procurement.payment.approve')
  approvePayment(@Param('id') id: string, @Body(zodBody(approvePaymentSchema)) body: { note?: string }) {
    return this.procurement.approvePayment(id, body);
  }
}
