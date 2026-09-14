import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import {
  approveDocumentSchema,
  executeContractSchema,
  generateContractSchema,
  generateDocumentSchema,
  submitDocumentSchema,
  type ExecuteContract,
  type GenerateContract,
  type GenerateDocument,
} from '@chc/contracts';
import { z } from 'zod';

import { AuditAction, RequirePermission } from '../../common/decorators';
import { zodBody } from '../../common/pipes/zod-validation.pipe';

import { ContractService } from './contract.service';
import { DocumentService } from './document.service';

@Controller({ path: 'documents', version: '1' })
export class DocumentController {
  constructor(private readonly documents: DocumentService) {}

  /**
   * Produce a version from current data.
   *
   * Always a new version. A document that silently re-rendered under a reader
   * would make every citation of it unreliable.
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('document.generate')
  @AuditAction('document.generate')
  generate(@Body(zodBody(generateDocumentSchema)) body: GenerateDocument) {
    return this.documents.generate(body);
  }

  @Get(':id')
  @RequirePermission('document.read')
  get(@Param('id') id: string) {
    return this.documents.get(id);
  }

  /** The artefact itself, read back from storage exactly as it was written. */
  @Get(':id/content')
  @RequirePermission('document.read')
  content(@Param('id') id: string, @Query('version') version?: string) {
    return this.documents.content(id, version ? Number(version) : undefined);
  }

  /** Refused below the completeness threshold for the document's type. */
  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('document.generate')
  @AuditAction('document.submit')
  submit(@Param('id') id: string, @Body(zodBody(submitDocumentSchema)) body: { note?: string }) {
    return this.documents.submit(id, body);
  }

  /** The generator may not approve their own document. */
  @Post(':id/decide')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('document.approve')
  @AuditAction('document.decide')
  decide(
    @Param('id') id: string,
    @Body(zodBody(approveDocumentSchema)) body: z.infer<typeof approveDocumentSchema>,
  ) {
    return this.documents.decide(id, body);
  }
}

@Controller({ path: 'contracts', version: '1' })
export class ContractController {
  constructor(private readonly contracts: ContractService) {}

  /**
   * Draft an agreement from the partnership configuration the system holds.
   *
   * Every generated copy carries the draft banner on every page. There is no
   * parameter that removes it (spec §52, §83).
   */
  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('contract.draft')
  @AuditAction('contract.generate')
  generate(@Body(zodBody(generateContractSchema)) body: GenerateContract) {
    return this.contracts.generate(body);
  }

  @Get(':id/content')
  @RequirePermission('contract.read')
  content(@Param('id') id: string, @Query('version') version?: string) {
    return this.contracts.content(id, version ? Number(version) : undefined);
  }

  /** The banner comes off only here, and only with the signed file and signatories. */
  @Post(':id/execute')
  @HttpCode(HttpStatus.OK)
  @RequirePermission('contract.execute')
  @AuditAction('contract.execute')
  execute(@Param('id') id: string, @Body(zodBody(executeContractSchema)) body: ExecuteContract) {
    return this.contracts.execute(id, body);
  }
}
