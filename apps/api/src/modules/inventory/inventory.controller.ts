import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  adjustStockSchema,
  dispensePreviewSchema,
  dispenseSchema,
  receiveStockSchema,
  returnDispensingSchema,
  writeOffStockSchema,
  type AdjustStock,
  type Dispense,
  type ReceiveStock,
  type ReturnDispensing,
  type WriteOffStock,
} from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { InventoryService } from './inventory.service';
import { PharmacyService } from './pharmacy.service';

@Controller({ path: 'inventory', version: '1' })
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Post('receive')
  @RequirePermission('inventory.receive')
  @AuditAction('inventory.receive')
  receive(@Body(zodBody(receiveStockSchema)) body: ReceiveStock) {
    return this.inventory.receive(body);
  }

  /** Each batch's status derived from the date, not from when a job last ran. */
  @Get('stock')
  @RequirePermission('inventory.read')
  stock(@Query('facilityId') facilityId: string, @Query('itemId') itemId?: string) {
    return this.inventory.stockOnHand(facilityId, itemId);
  }

  /** The stock identity, proved against the ledger (spec §45). */
  @Get('batches/:id/reconcile')
  @RequirePermission('inventory.read')
  reconcile(@Param('id') id: string, @Query('from') from?: string) {
    return this.inventory.reconcileBatch(id, from);
  }

  /** Needs a reason and somebody other than the counter. */
  @Post('adjust')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.adjust')
  @AuditAction('inventory.adjust')
  adjust(@Body(zodBody(adjustStockSchema)) body: AdjustStock) {
    return this.inventory.adjust(body);
  }

  @Post('write-off')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('inventory.adjust')
  @AuditAction('inventory.write_off')
  writeOff(@Body(zodBody(writeOffStockSchema)) body: WriteOffStock) {
    return this.inventory.writeOff(body);
  }

  @Get('expiring')
  @RequirePermission('inventory.read')
  expiring(@Query('facilityId') facilityId: string, @Query('days') days?: string) {
    return this.inventory.expiryReport(facilityId, days ? Number(days) : undefined);
  }
}

@Controller({ path: 'pharmacy', version: '1' })
export class PharmacyController {
  constructor(private readonly pharmacy: PharmacyService) {}

  /** What FEFO would choose, before anything moves. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('pharmacy.read')
  preview(@Body(zodBody(dispensePreviewSchema)) body: z.infer<typeof dispensePreviewSchema>) {
    return this.pharmacy.preview(body);
  }

  /** Stock, charge and ledger in one transaction — criterion H. */
  @Post('dispense')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('pharmacy.dispense')
  @AuditAction('pharmacy.dispense')
  dispense(@Body(zodBody(dispenseSchema)) body: Dispense) {
    return this.pharmacy.dispense(body);
  }

  @Post('returns')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('pharmacy.dispense')
  @AuditAction('pharmacy.return')
  recordReturn(@Body(zodBody(returnDispensingSchema)) body: ReturnDispensing) {
    return this.pharmacy.recordReturn(body);
  }
}
