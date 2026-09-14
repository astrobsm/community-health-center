import { Body, Controller, Get, HttpCode, HttpStatus, Post, Query } from '@nestjs/common';
import {
  issueInvoiceSchema,
  raiseChargeSchema,
  receivePaymentSchema,
  waiveChargeSchema,
  type IssueInvoice,
  type RaiseCharge,
  type ReceivePayment,
  type WaiveCharge,
} from '@chc/contracts';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { BillingService } from './billing.service';

/**
 * Billing (spec §§31-32).
 *
 * Raising a charge, billing for it, taking the money and waiving it are four
 * different permissions, because in a facility they are often four different
 * people — and where they are the same person, the audit trail should still be
 * able to tell the four acts apart.
 */
@Controller({ path: 'billing', version: '1' })
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('charges')
  @RequirePermission('billing.charge')
  @AuditAction('billing.charge')
  raiseCharge(@Body(zodBody(raiseChargeSchema)) body: RaiseCharge) {
    return this.billing.raiseCharge(body);
  }

  @Post('waive')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('billing.waive')
  @AuditAction('billing.waive')
  waive(@Body(zodBody(waiveChargeSchema)) body: WaiveCharge) {
    return this.billing.waive(body);
  }

  @Post('invoices')
  @RequirePermission('billing.invoice')
  @AuditAction('billing.invoice')
  issue(@Body(zodBody(issueInvoiceSchema)) body: IssueInvoice) {
    return this.billing.issueInvoice(body);
  }

  @Get('invoices')
  @RequirePermission('billing.read')
  list(@Query('facilityId') facilityId: string) {
    return this.billing.listInvoices(facilityId);
  }

  @Post('payments')
  @RequirePermission('payment.receive')
  @AuditAction('payment.receive')
  receive(@Body(zodBody(receivePaymentSchema)) body: ReceivePayment) {
    return this.billing.receivePayment(body);
  }
}
