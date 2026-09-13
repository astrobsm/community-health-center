import type { AccountType, NormalBalance } from '@prisma/client';

/**
 * Chart of accounts (doc 12 §2).
 *
 * Seeded as reference data an organisation may extend. Heading accounts are
 * `isPostable: false` so nothing can be posted to a total.
 *
 * Note 2150/2160 and 7110-7140: the partnership waterfall recognises the
 * government's entitlement and the partner's recovery through the SAME ledger
 * as everything else. There is no separate partnership spreadsheet, which is
 * why "financial data feeds partnership calculations" is provable rather than
 * a promise.
 */
export const CHART_OF_ACCOUNTS: Array<{
  code: string;
  name: string;
  accountType: AccountType;
  normalBalance: NormalBalance;
  isPostable: boolean;
  parentCode?: string;
}> = [
  // 1000 ASSETS
  { code: '1000', name: 'Assets', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: false },
  { code: '1100', name: 'Current assets', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: false, parentCode: '1000' },
  { code: '1110', name: 'Cash on hand', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1100' },
  { code: '1120', name: 'Bank', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1100' },
  { code: '1130', name: 'Patient receivables', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1100' },
  { code: '1140', name: 'NHIS / HMO receivables', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1100' },
  { code: '1150', name: 'Inventory — medicines', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1100' },
  { code: '1160', name: 'Inventory — consumables', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1100' },
  { code: '1170', name: 'Inventory — laboratory reagents', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1100' },

  { code: '1200', name: 'Non-current assets', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: false, parentCode: '1000' },
  { code: '1210', name: 'Buildings and improvements', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1200' },
  { code: '1220', name: 'Medical equipment', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1200' },
  { code: '1230', name: 'Laboratory equipment', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1200' },
  { code: '1240', name: 'ICT equipment', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1200' },
  { code: '1250', name: 'Furniture and fittings', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1200' },
  { code: '1260', name: 'Power and water infrastructure', accountType: 'ASSET', normalBalance: 'DEBIT', isPostable: true, parentCode: '1200' },
  { code: '1290', name: 'Accumulated depreciation', accountType: 'ASSET', normalBalance: 'CREDIT', isPostable: true, parentCode: '1200' },

  // 2000 LIABILITIES
  { code: '2000', name: 'Liabilities', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: false },
  { code: '2110', name: 'Supplier payables', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '2000' },
  { code: '2120', name: 'Accrued staff costs', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '2000' },
  { code: '2130', name: 'Accrued staff incentives', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '2000' },
  { code: '2140', name: 'Patient deposits', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '2000' },
  { code: '2150', name: 'Government entitlement payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '2000' },
  { code: '2160', name: 'Partner capital recovery payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '2000' },
  { code: '2170', name: 'Statutory deductions payable', accountType: 'LIABILITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '2000' },

  // 3000 EQUITY / CAPITAL
  { code: '3000', name: 'Equity and capital', accountType: 'EQUITY', normalBalance: 'CREDIT', isPostable: false },
  { code: '3110', name: 'Partner capital contributed', accountType: 'EQUITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '3000' },
  { code: '3120', name: 'Government contributed assets', accountType: 'EQUITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '3000' },
  { code: '3130', name: 'Retained surplus', accountType: 'EQUITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '3000' },
  { code: '3140', name: 'Maintenance and development reserve', accountType: 'EQUITY', normalBalance: 'CREDIT', isPostable: true, parentCode: '3000' },

  // 4000 REVENUE
  { code: '4000', name: 'Revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: false },
  { code: '4110', name: 'Consultation revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },
  { code: '4120', name: 'Laboratory revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },
  { code: '4130', name: 'Pharmacy revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },
  { code: '4140', name: 'Procedure revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },
  { code: '4150', name: 'Maternity revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },
  { code: '4160', name: 'Immunisation and preventive revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },
  { code: '4170', name: 'Admission revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },
  { code: '4180', name: 'Other clinical revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },
  { code: '4190', name: 'Non-clinical revenue', accountType: 'REVENUE', normalBalance: 'CREDIT', isPostable: true, parentCode: '4000' },

  // 5000 DIRECT COSTS
  { code: '5000', name: 'Direct costs', accountType: 'DIRECT_COST', normalBalance: 'DEBIT', isPostable: false },
  { code: '5110', name: 'Cost of medicines dispensed', accountType: 'DIRECT_COST', normalBalance: 'DEBIT', isPostable: true, parentCode: '5000' },
  { code: '5120', name: 'Cost of reagents consumed', accountType: 'DIRECT_COST', normalBalance: 'DEBIT', isPostable: true, parentCode: '5000' },
  { code: '5130', name: 'Cost of consumables used', accountType: 'DIRECT_COST', normalBalance: 'DEBIT', isPostable: true, parentCode: '5000' },
  { code: '5140', name: 'Stock wastage and expiry write-off', accountType: 'DIRECT_COST', normalBalance: 'DEBIT', isPostable: true, parentCode: '5000' },

  // 6000 OPERATING EXPENSES
  { code: '6000', name: 'Operating expenses', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: false },
  { code: '6110', name: 'Salaries and wages', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6120', name: 'Staff incentives', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6130', name: 'Training and development', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6210', name: 'Power, diesel and solar', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6220', name: 'Water', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6230', name: 'Communications and internet', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6310', name: 'Repairs and maintenance', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6320', name: 'Cleaning and waste disposal', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6330', name: 'Security', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6410', name: 'Regulatory fees and licences', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6420', name: 'Insurance', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6430', name: 'Bank charges', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6440', name: 'Professional and audit fees', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6450', name: 'Community engagement and outreach', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },
  { code: '6510', name: 'Depreciation', accountType: 'EXPENSE', normalBalance: 'DEBIT', isPostable: true, parentCode: '6000' },

  // 7000 DISTRIBUTIONS — the waterfall lands here
  { code: '7000', name: 'Distributions', accountType: 'DISTRIBUTION', normalBalance: 'DEBIT', isPostable: false },
  { code: '7110', name: 'Government entitlement', accountType: 'DISTRIBUTION', normalBalance: 'DEBIT', isPostable: true, parentCode: '7000' },
  { code: '7120', name: 'Partner return', accountType: 'DISTRIBUTION', normalBalance: 'DEBIT', isPostable: true, parentCode: '7000' },
  { code: '7130', name: 'Transfer to maintenance reserve', accountType: 'DISTRIBUTION', normalBalance: 'DEBIT', isPostable: true, parentCode: '7000' },
  { code: '7140', name: 'Reinvestment', accountType: 'DISTRIBUTION', normalBalance: 'DEBIT', isPostable: true, parentCode: '7000' },
];
