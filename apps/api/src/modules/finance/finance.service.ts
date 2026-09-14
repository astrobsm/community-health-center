import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PeriodClosedError, ReasonRequiredError } from '../../common/errors';
import { getTenantScope, tryGetContext } from '../../common/request-context';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

import { reconcileCash, type JournalEntryDraft } from './domain/posting';

/**
 * The ledger (doc 12 §5).
 *
 * Every posting in the system goes through `post()`. One door, so there is
 * exactly one place where an entry can reach the accounts, and exactly one
 * place that knows how a draft becomes journal rows.
 *
 * Three things it refuses: an unbalanced entry (the domain builder and a
 * deferred database trigger both check), a posting into a closed period, and
 * an account code the chart of accounts does not hold. The third matters more
 * than it looks — a typo in an account code would put real money into an
 * account nobody reconciles.
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private now(): Date {
    return new Date();
  }

  /**
   * Post a drafted entry.
   *
   * Takes an optional transaction client, because a dispensing must write the
   * stock movement, the charge and these journal lines atomically or not at
   * all (criterion H). Passing the client through is what makes "atomically"
   * true rather than aspirational.
   */
  async post(
    draft: JournalEntryDraft,
    context: { facilityId: string; entryDate: Date },
    tx?: Prisma.TransactionClient,
  ): Promise<{ id: string; reference: string }> {
    const client = tx ?? this.prisma;
    const { organisationId } = getTenantScope();
    const requestContext = tryGetContext();

    const period = await this.periodFor(context.facilityId, context.entryDate, client);

    const codes = [...new Set(draft.lines.map((line) => line.accountCode))];

    const accounts = await client.financialAccount.findMany({
      where: { organisationId, code: { in: codes }, isPostable: true },
      select: { id: true, code: true },
    });

    const byCode = new Map(accounts.map((account) => [account.code, account.id]));
    const missing = codes.filter((code) => !byCode.has(code));

    if (missing.length > 0) {
      // A typo here would put real money into an account nobody reconciles.
      throw new BadRequestException(
        `The chart of accounts has no postable account for: ${missing.join(', ')}. ` +
          'Seed the reference data, or correct the posting rule that produced this entry.',
      );
    }

    const count = await client.journalEntry.count({ where: { organisationId } });
    const reference = `JE-${String(count + 1).padStart(8, '0')}`;

    const entry = await client.journalEntry.create({
      data: {
        id: randomUUID(),
        organisationId,
        facilityId: context.facilityId,
        financialPeriodId: period.id,
        reference,
        entryDate: context.entryDate,
        description: draft.description,
        sourceType: draft.sourceType,
        sourceId: draft.sourceId,
        postedBy: requestContext?.userId,
        lines: {
          create: draft.lines.map((line) => ({
            financialAccountId: byCode.get(line.accountCode)!,
            organisationId,
            facilityId: context.facilityId,
            debitMinor: BigInt(line.debitMinor),
            creditMinor: BigInt(line.creditMinor),
            description: line.description,
          })),
        },
      },
      select: { id: true, reference: true },
    });

    return entry;
  }

  /**
   * The open period covering a date.
   *
   * Refused when the period is closed. A closed period has been reported to
   * somebody; a late posting into it changes a figure that has already been
   * read and acted upon.
   */
  private async periodFor(facilityId: string, date: Date, client: Prisma.TransactionClient | PrismaService) {
    const period = await client.financialPeriod.findFirst({
      where: { facilityId, startDate: { lte: date }, endDate: { gte: date } },
      select: { id: true, name: true, status: true },
    });

    if (!period) {
      throw new BadRequestException(
        `No financial period covers ${date.toISOString().slice(0, 10)}. ` +
          'Open the period before posting into it, so the month it belongs to is never in doubt.',
      );
    }

    if (period.status === 'CLOSED') throw new PeriodClosedError(period.name);

    return period;
  }

  async openPeriod(input: { facilityId: string; name: string; startDate: string; endDate: string }) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const period = await this.prisma.financialPeriod.create({
      data: {
        organisationId,
        facilityId: input.facilityId,
        name: input.name,
        startDate: new Date(input.startDate),
        endDate: new Date(input.endDate),
      },
      select: { id: true, name: true, startDate: true, endDate: true, status: true },
    });

    await this.audit.record({
      action: 'finance.period.open',
      entityType: 'financial_period',
      entityId: period.id,
      facilityId: input.facilityId,
      newValue: { name: period.name },
    });

    return period;
  }

  /**
   * Close a period.
   *
   * Refused while anything in it is still unbalanced or unposted, because a
   * closed period is a figure somebody will report.
   */
  async closePeriod(periodId: string, input: { note?: string }) {
    const { organisationId, facilityIds } = getTenantScope();
    const context = tryGetContext();

    const period = await this.prisma.financialPeriod.findFirst({
      where: { id: periodId, organisationId },
      select: { id: true, facilityId: true, name: true, status: true, startDate: true, endDate: true },
    });

    if (!period || !facilityIds.includes(period.facilityId)) {
      throw new NotFoundException('No such financial period, or it is not visible to you.');
    }

    if (period.status === 'CLOSED') {
      throw new BadRequestException(`${period.name} is already closed.`);
    }

    const trial = await this.trialBalance(period.facilityId, period.id);

    if (!trial.balances) {
      throw new BadRequestException(
        `${period.name} does not balance: debits ${trial.totalDebitMinor} against credits ` +
          `${trial.totalCreditMinor}. Find the difference before closing; a closed period is a figure ` +
          'somebody will report.',
      );
    }

    const closed = await this.prisma.financialPeriod.update({
      where: { id: period.id },
      data: { status: 'CLOSED', closedBy: context?.userId, closedAt: this.now() },
      select: { id: true, name: true, status: true, closedAt: true },
    });

    await this.audit.record({
      action: 'finance.period.close',
      entityType: 'financial_period',
      entityId: period.id,
      facilityId: period.facilityId,
      oldValue: { status: period.status },
      newValue: { status: 'CLOSED', entries: trial.entryCount },
      reason: input.note,
      severity: 'CRITICAL',
    });

    return {
      ...closed,
      trialBalance: trial,
      note: 'Nothing can be posted into this period now. A correction is a reversal in the current period.',
    };
  }

  /**
   * The trial balance, computed from the journal lines.
   *
   * Never stored. The moment a balance is cached it can disagree with the
   * entries beneath it, and then nobody knows which is right (§10).
   */
  async trialBalance(facilityId: string, financialPeriodId?: string) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const lines = await this.prisma.journalLine.findMany({
      where: {
        facilityId,
        organisationId,
        ...(financialPeriodId ? { journalEntry: { financialPeriodId } } : {}),
      },
      select: {
        debitMinor: true,
        creditMinor: true,
        financialAccount: { select: { code: true, name: true, accountType: true } },
      },
    });

    const byAccount = new Map<string, { name: string; type: string; debit: bigint; credit: bigint }>();
    let totalDebit = 0n;
    let totalCredit = 0n;

    for (const line of lines) {
      const code = line.financialAccount.code;
      const entry = byAccount.get(code) ?? {
        name: line.financialAccount.name,
        type: line.financialAccount.accountType,
        debit: 0n,
        credit: 0n,
      };

      entry.debit += line.debitMinor;
      entry.credit += line.creditMinor;
      totalDebit += line.debitMinor;
      totalCredit += line.creditMinor;

      byAccount.set(code, entry);
    }

    const entries = await this.prisma.journalEntry.count({
      where: { facilityId, organisationId, ...(financialPeriodId ? { financialPeriodId } : {}) },
    });

    return {
      accounts: [...byAccount]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([code, entry]) => ({
          code,
          name: entry.name,
          accountType: entry.type,
          debitMinor: entry.debit.toString(),
          creditMinor: entry.credit.toString(),
          balanceMinor: (entry.debit - entry.credit).toString(),
        })),
      totalDebitMinor: totalDebit.toString(),
      totalCreditMinor: totalCredit.toString(),
      balances: totalDebit === totalCredit,
      entryCount: entries,
      classification: 'ACTUAL' as const,
    };
  }

  /**
   * The day's cash position (spec §45).
   *
   * Every figure read from the ledger and the payments, so the expected
   * closing is what the day actually did rather than what somebody remembers.
   */
  async dailyCash(input: { facilityId: string; date: string; countedClosingMinor: number; note?: string }) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(input.facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const day = new Date(input.date);
    const dayStart = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()));
    const dayEnd = new Date(dayStart.getTime() + 86_400_000);

    const cashAccount = await this.prisma.financialAccount.findFirst({
      where: { organisationId, code: '1110' },
      select: { id: true },
    });

    if (!cashAccount) {
      throw new BadRequestException('The chart of accounts has no cash account. Seed the reference data.');
    }

    const opening = await this.prisma.journalLine.aggregate({
      where: {
        facilityId: input.facilityId,
        financialAccountId: cashAccount.id,
        journalEntry: { entryDate: { lt: dayStart } },
      },
      _sum: { debitMinor: true, creditMinor: true },
    });

    const movement = await this.prisma.journalLine.findMany({
      where: {
        facilityId: input.facilityId,
        financialAccountId: cashAccount.id,
        journalEntry: { entryDate: { gte: dayStart, lt: dayEnd } },
      },
      select: { debitMinor: true, creditMinor: true },
    });

    const openingMinor = Number((opening._sum.debitMinor ?? 0n) - (opening._sum.creditMinor ?? 0n));
    const receiptsMinor = movement.reduce((sum, line) => sum + Number(line.debitMinor), 0);
    const paidOutMinor = movement.reduce((sum, line) => sum + Number(line.creditMinor), 0);

    const reconciliation = reconcileCash({
      openingMinor,
      receiptsMinor,
      // Banking and other cash payments both credit the cash account; they
      // are reported together rather than guessed apart.
      paymentsOutMinor: paidOutMinor,
      bankedMinor: 0,
      countedClosingMinor: input.countedClosingMinor,
    });

    const context = tryGetContext();

    const record = await this.prisma.dailyCashReconciliation.create({
      data: {
        organisationId,
        facilityId: input.facilityId,
        businessDate: dayStart,
        openingBalanceMinor: BigInt(openingMinor),
        receiptsMinor: BigInt(receiptsMinor),
        expensesMinor: BigInt(paidOutMinor),
        expectedClosingMinor: BigInt(reconciliation.expectedClosingMinor),
        countedClosingMinor: BigInt(input.countedClosingMinor),
        varianceMinor: BigInt(reconciliation.varianceMinor),
        varianceReason: input.note,
        countedBy: context?.userId,
      },
      select: { id: true, businessDate: true },
    });

    if (!reconciliation.balances && (input.note ?? '').trim().length < 5) {
      // Recorded either way — the figure is the figure — but a variance with
      // no explanation is a pattern nobody can investigate later.
      await this.audit.record({
        action: 'finance.cash.reconcile',
        entityType: 'daily_cash_reconciliation',
        entityId: record.id,
        facilityId: input.facilityId,
        newValue: { varianceMinor: reconciliation.varianceMinor, explained: false },
        severity: 'WARNING',
      });

      throw new ReasonRequiredError(
        `Closing the day with a variance of ${reconciliation.varianceMinor} kobo`,
      );
    }

    await this.audit.record({
      action: 'finance.cash.reconcile',
      entityType: 'daily_cash_reconciliation',
      entityId: record.id,
      facilityId: input.facilityId,
      newValue: {
        expectedMinor: reconciliation.expectedClosingMinor,
        countedMinor: input.countedClosingMinor,
        varianceMinor: reconciliation.varianceMinor,
      },
      reason: input.note,
      severity: reconciliation.balances ? 'INFO' : 'NOTICE',
    });

    return { id: record.id, date: input.date, ...reconciliation };
  }

  /** The entries behind a figure, so any total can be opened up. */
  async entriesFor(facilityId: string, sourceType: string, sourceId: string) {
    const { organisationId, facilityIds } = getTenantScope();

    if (!facilityIds.includes(facilityId)) {
      throw new NotFoundException('No such facility, or it is not visible to you.');
    }

    const entries = await this.prisma.journalEntry.findMany({
      where: { organisationId, facilityId, sourceType, sourceId },
      orderBy: { postedAt: 'asc' },
      select: {
        id: true,
        reference: true,
        description: true,
        entryDate: true,
        status: true,
        lines: {
          select: {
            debitMinor: true,
            creditMinor: true,
            description: true,
            financialAccount: { select: { code: true, name: true } },
          },
        },
      },
    });

    return entries.map((entry) => ({
      ...entry,
      lines: entry.lines.map((line) => ({
        accountCode: line.financialAccount.code,
        accountName: line.financialAccount.name,
        debitMinor: line.debitMinor.toString(),
        creditMinor: line.creditMinor.toString(),
        description: line.description,
      })),
      balances:
        entry.lines.reduce((sum, line) => sum + line.debitMinor, 0n) ===
        entry.lines.reduce((sum, line) => sum + line.creditMinor, 0n),
    }));
  }
}
