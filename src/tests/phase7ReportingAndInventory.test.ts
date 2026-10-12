/**
 * AuraPOS Phase 7 — Reporting and Inventory Operations Test Suite
 *
 * Verifies:
 * 1. Multi-dimensional sales filtering (date range presets, custom range, terminal, cashier, category)
 * 2. Daily & hourly sales distribution calculations
 * 3. Product performance, COGS, gross profit, and margin percentage calculations
 * 4. Payment tender distribution & transaction share percentages
 * 5. Refund analytics, refund rate, and reason breakdown
 * 6. Cash drawer shift discrepancy audit (expected vs actual, balanced/over/short thresholds)
 * 7. Inventory valuation summary (retail value, cost value, potential profit, margin %, alerts)
 * 8. Physical stock count session lifecycle & variance reconciliation into stock and movements
 * 9. Supplier directory and Purchase Order creation & receiving workflow with stock increment
 * 10. RFC 4180 CSV exports (financial report, stock valuation, movements ledger) and Z-Report thermal format
 */

import path from 'path';
import { ReportingService } from '../services/reportingService.ts';
import { InventoryService } from '../services/inventoryService.ts';
import { StorageService } from '../services/storageService.ts';
import { Sale, Product, Category, Employee } from '../types/pos.ts';
import { Supplier, PurchaseOrder, StockCountItem } from '../types/inventoryOperations.ts';
import { ReportFilterOptions } from '../types/reporting.ts';

interface TestResult {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

const results: TestResult[] = [];

function assertTest(condition: boolean, name: string, expected: string, actual: string) {
  results.push({ name, passed: condition, expected, actual });
  const status = condition ? '[PASS]' : '[FAIL]';
  console.log(`  ${status} ${name}`);
  console.log(`      Expected: ${expected}`);
  console.log(`      Actual:   ${actual}`);
  if (!condition) {
    console.error(`      -> FAILURE DETECTED!`);
  }
}

export async function runPhase7Tests() {
  console.log('======================================================================');
  console.log('AURAPOS PHASE 7 — REPORTING & INVENTORY OPERATIONS TEST SUITE');
  console.log('======================================================================\n');

  const storeId = 'store_test_phase7';

  // Seed Categories
  const categories: Category[] = [
    { id: 'cat_coffee', storeId, name: 'Coffee & Espresso', iconName: 'coffee', color: '#6F4E37', sortOrder: 1, active: true },
    { id: 'cat_bakery', storeId, name: 'Pastries & Bakery', iconName: 'croissant', color: '#D4A373', sortOrder: 2, active: true },
    { id: 'cat_retail', storeId, name: 'Retail Beans', iconName: 'package', color: '#4A3525', sortOrder: 3, active: true }
  ];

  // Seed Employees
  const employees: Employee[] = [
    { id: 'emp_maria', storeId, name: 'Maria Santos', email: 'maria@aurapos.local', phone: '+15551234567', role: 'cashier', pin: '1111', active: true, permissions: [] },
    { id: 'emp_carlos', storeId, name: 'Carlos Ramos', email: 'carlos@aurapos.local', phone: '+15559876543', role: 'manager', pin: '2222', active: true, permissions: [] }
  ];

  // Seed Products with costs, prices, stock, and timestamps
  const products: Product[] = [
    {
      id: 'prod_latte',
      storeId,
      categoryId: 'cat_coffee',
      name: 'Caramel Oat Latte',
      sku: 'LAT-OAT-CAR',
      barcode: '775000000001',
      price: 5.50,
      cost: 1.50,
      unit: 'cup',
      trackInventory: true,
      stock: 40,
      lowStockThreshold: 10,
      active: true,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z'
    },
    {
      id: 'prod_croissant',
      storeId,
      categoryId: 'cat_bakery',
      name: 'Butter Croissant',
      sku: 'BAK-CRO-BUT',
      barcode: '775000000002',
      price: 3.50,
      cost: 1.00,
      unit: 'item',
      trackInventory: true,
      stock: 8, // Low stock (<= 10)
      lowStockThreshold: 10,
      active: true,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z'
    },
    {
      id: 'prod_beans',
      storeId,
      categoryId: 'cat_retail',
      name: 'House Blend Beans 500g',
      sku: 'RET-BEA-500',
      barcode: '775000000003',
      price: 18.00,
      cost: 9.00,
      unit: 'item',
      trackInventory: true,
      stock: 0, // Out of stock
      lowStockThreshold: 5,
      active: true,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z'
    },
    {
      id: 'prod_mug',
      storeId,
      categoryId: 'cat_retail',
      name: 'Ceramic Logo Mug',
      sku: 'RET-MUG-CER',
      barcode: '775000000004',
      price: 15.00,
      cost: 5.00,
      unit: 'item',
      trackInventory: false, // Untracked inventory
      stock: 100,
      lowStockThreshold: 5,
      active: true,
      createdAt: '2026-10-01T08:00:00.000Z',
      updatedAt: '2026-10-01T08:00:00.000Z'
    }
  ];

  StorageService.saveCategories(categories);
  StorageService.saveEmployees(employees);
  StorageService.saveProducts(products);
  StorageService.saveInventoryMovements([]);
  StorageService.saveSuppliers([]);
  StorageService.savePurchaseOrders([]);
  StorageService.saveStockCountSessions([]);

  // Seed Sales over different dates, times, cashiers, terminals, and payment methods
  const now = new Date();
  const todayIso = now.toISOString();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  yesterday.setHours(14, 30, 0, 0);
  const yesterdayIso = yesterday.toISOString();

  const threeDaysAgo = new Date(now);
  threeDaysAgo.setDate(now.getDate() - 3);
  threeDaysAgo.setHours(9, 15, 0, 0);
  const threeDaysAgoIso = threeDaysAgo.toISOString();

  const sampleSales: (Sale & { terminalId?: string })[] = [
    // Sale 1: Today, Maria, Terminal 1, 2 Lattes + 1 Croissant, Paid Cash
    {
      id: 'sale_001',
      storeId,
      employeeId: 'emp_maria',
      employeeName: 'Maria Santos',
      terminalId: 'term_pos_01',
      receiptNumber: 'REC-2026-001',
      subtotal: 14.50, // (5.50 * 2) + 3.50
      taxRate: 0.10,
      taxAmount: 1.45,
      discountAmount: 0.00,
      total: 15.95,
      items: [
        {
          id: 'item_001_1',
          saleId: 'sale_001',
          productId: 'prod_latte',
          productName: 'Caramel Oat Latte',
          quantity: 2,
          unitPrice: 5.50,
          discountAmount: 0,
          taxAmount: 1.10,
          lineTotal: 11.00
        },
        {
          id: 'item_001_2',
          saleId: 'sale_001',
          productId: 'prod_croissant',
          productName: 'Butter Croissant',
          quantity: 1,
          unitPrice: 3.50,
          discountAmount: 0,
          taxAmount: 0.35,
          lineTotal: 3.50
        }
      ],
      payments: [
        { id: 'pay_001', method: 'cash', amount: 15.95, status: 'completed', createdAt: todayIso }
      ],
      status: 'completed',
      createdAt: todayIso,
      updatedAt: todayIso
    },
    // Sale 2: Today, Carlos, Terminal 2, 1 Beans, Paid Card ($18.00 + $1.80 tax, $2.00 discount)
    {
      id: 'sale_002',
      storeId,
      employeeId: 'emp_carlos',
      employeeName: 'Carlos Ramos',
      terminalId: 'term_pos_02',
      receiptNumber: 'REC-2026-002',
      subtotal: 18.00,
      taxRate: 0.10,
      taxAmount: 1.60,
      discountAmount: 2.00,
      total: 17.60,
      items: [
        {
          id: 'item_002_1',
          saleId: 'sale_002',
          productId: 'prod_beans',
          productName: 'House Blend Beans 500g',
          quantity: 1,
          unitPrice: 18.00,
          discountAmount: 2.00,
          taxAmount: 1.60,
          lineTotal: 16.00
        }
      ],
      payments: [
        { id: 'pay_002', method: 'card', amount: 17.60, status: 'completed', createdAt: todayIso }
      ],
      status: 'completed',
      createdAt: todayIso,
      updatedAt: todayIso
    },
    // Sale 3: Yesterday, Maria, Terminal 1, 1 Latte, Refunded
    {
      id: 'sale_003',
      storeId,
      employeeId: 'emp_maria',
      employeeName: 'Maria Santos',
      terminalId: 'term_pos_01',
      receiptNumber: 'REC-2026-003',
      subtotal: 5.50,
      taxRate: 0.10,
      taxAmount: 0.55,
      discountAmount: 0.00,
      total: 6.05,
      items: [
        {
          id: 'item_003_1',
          saleId: 'sale_003',
          productId: 'prod_latte',
          productName: 'Caramel Oat Latte',
          quantity: 1,
          unitPrice: 5.50,
          discountAmount: 0,
          taxAmount: 0.55,
          lineTotal: 5.50
        }
      ],
      payments: [
        { id: 'pay_003', method: 'cash', amount: 6.05, status: 'completed', createdAt: yesterdayIso }
      ],
      status: 'refunded',
      notes: 'Customer dropped beverage',
      createdAt: yesterdayIso,
      updatedAt: yesterdayIso
    },
    // Sale 4: 3 Days Ago, Carlos, Terminal 1, 2 Croissants, Paid Mobile/QR
    {
      id: 'sale_004',
      storeId,
      employeeId: 'emp_carlos',
      employeeName: 'Carlos Ramos',
      terminalId: 'term_pos_01',
      receiptNumber: 'REC-2026-004',
      subtotal: 7.00,
      taxRate: 0.10,
      taxAmount: 0.70,
      discountAmount: 0.00,
      total: 7.70,
      items: [
        {
          id: 'item_004_1',
          saleId: 'sale_004',
          productId: 'prod_croissant',
          productName: 'Butter Croissant',
          quantity: 2,
          unitPrice: 3.50,
          discountAmount: 0,
          taxAmount: 0.70,
          lineTotal: 7.00
        }
      ],
      payments: [
        { id: 'pay_004', method: 'mobile', amount: 7.70, status: 'completed', createdAt: threeDaysAgoIso }
      ],
      status: 'completed',
      createdAt: threeDaysAgoIso,
      updatedAt: threeDaysAgoIso
    }
  ];

  StorageService.saveSales(sampleSales);

  // ---------------------------------------------------------------------------
  // TEST SUITE 1: Multi-Dimensional Sales Filtering
  // ---------------------------------------------------------------------------
  console.log('\n--- 1. Multi-Dimensional Sales Filtering ---');

  // Filter 1.1: 'today'
  const filterToday: ReportFilterOptions = { dateRange: 'today' };
  const todayFiltered = ReportingService.filterSales(sampleSales, filterToday, products);
  assertTest(
    todayFiltered.length === 2 && todayFiltered.every(s => s.id === 'sale_001' || s.id === 'sale_002'),
    'Date Preset Filtering (today)',
    '2 sales matching today',
    `${todayFiltered.length} sales returned: [${todayFiltered.map(s => s.id).join(', ')}]`
  );

  // Filter 1.2: 'yesterday'
  const filterYesterday: ReportFilterOptions = { dateRange: 'yesterday' };
  const yesterdayFiltered = ReportingService.filterSales(sampleSales, filterYesterday, products);
  assertTest(
    yesterdayFiltered.length === 1 && yesterdayFiltered[0].id === 'sale_003',
    'Date Preset Filtering (yesterday)',
    '1 sale matching yesterday (sale_003)',
    `${yesterdayFiltered.length} sales returned: [${yesterdayFiltered.map(s => s.id).join(', ')}]`
  );

  // Filter 1.3: Terminal filter (term_pos_02)
  const filterTerminal: ReportFilterOptions = { dateRange: '7days', terminalId: 'term_pos_02' };
  const terminalFiltered = ReportingService.filterSales(sampleSales, filterTerminal, products);
  assertTest(
    terminalFiltered.length === 1 && terminalFiltered[0].id === 'sale_002',
    'Terminal ID Filtering',
    '1 sale on term_pos_02 (sale_002)',
    `${terminalFiltered.length} sales: [${terminalFiltered.map(s => s.id).join(', ')}]`
  );

  // Filter 1.4: Employee filter (emp_carlos)
  const filterEmployee: ReportFilterOptions = { dateRange: '7days', employeeId: 'emp_carlos' };
  const employeeFiltered = ReportingService.filterSales(sampleSales, filterEmployee, products);
  assertTest(
    employeeFiltered.length === 2 && employeeFiltered.every(s => s.employeeId === 'emp_carlos'),
    'Cashier / Employee Filtering',
    '2 sales handled by emp_carlos (sale_002, sale_004)',
    `${employeeFiltered.length} sales: [${employeeFiltered.map(s => s.id).join(', ')}]`
  );

  // Filter 1.5: Category filter (cat_bakery)
  const filterCategory: ReportFilterOptions = { dateRange: '7days', categoryId: 'cat_bakery' };
  const categoryFiltered = ReportingService.filterSales(sampleSales, filterCategory, products);
  assertTest(
    categoryFiltered.length === 2 && categoryFiltered.every(s => s.id === 'sale_001' || s.id === 'sale_004'),
    'Category Filtering (cat_bakery)',
    '2 sales containing bakery items (sale_001, sale_004)',
    `${categoryFiltered.length} sales: [${categoryFiltered.map(s => s.id).join(', ')}]`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 2: Comprehensive Financial Metrics & Margin Calculations
  // ---------------------------------------------------------------------------
  console.log('\n--- 2. Comprehensive Financial Metrics & Margins ---');

  const allRangeFilter: ReportFilterOptions = { dateRange: '7days' };
  const financialReport = ReportingService.generateFinancialReport(
    sampleSales,
    products,
    categories,
    employees,
    [],
    allRangeFilter
  );

  // Completed sales: sale_001 ($14.50 gross, $0 disc), sale_002 ($18.00 gross, $2 disc), sale_004 ($7.00 gross, $0 disc)
  // Total filtered sales (incl refunded sale_003): Gross = 14.50 + 18.00 + 5.50 + 7.00 = 45.00
  // Net sales (completed): 14.50 + (18.00 - 2.00) + 7.00 = 37.50
  assertTest(
    financialReport.grossSales === 45.00 && financialReport.netSales === 37.50,
    'Gross and Net Sales Aggregation',
    'Gross $45.00, Net $37.50',
    `Gross $${financialReport.grossSales.toFixed(2)}, Net $${financialReport.netSales.toFixed(2)}`
  );

  // Total discounts = $2.00, total taxes = 1.45 + 1.60 + 0.55 + 0.70 = 4.30
  assertTest(
    financialReport.totalDiscounts === 2.00 && financialReport.totalTaxes === 4.30,
    'Discounts and Tax Totals',
    'Discounts $2.00, Taxes $4.30',
    `Discounts $${financialReport.totalDiscounts.toFixed(2)}, Taxes $${financialReport.totalTaxes.toFixed(2)}`
  );

  // COGS for completed sales:
  // sale_001: 2 Lattes ($1.50*2 = 3.00) + 1 Croissant ($1.00*1 = 1.00) = 4.00
  // sale_002: 1 Beans ($9.00*1 = 9.00) = 9.00
  // sale_004: 2 Croissants ($1.00*2 = 2.00) = 2.00
  // Total COGS = 4.00 + 9.00 + 2.00 = 15.00
  // Gross Profit = Net ($37.50) - COGS ($15.00) = 22.50
  // Margin % = (22.50 / 37.50) * 100 = 60.0%
  assertTest(
    financialReport.totalCostOfGoodsSold === 15.00 &&
    financialReport.totalGrossProfit === 22.50 &&
    financialReport.grossProfitMarginPct === 60.0,
    'COGS, Gross Profit, and Margin Percentage',
    'COGS $15.00, Gross Profit $22.50, Margin 60.0%',
    `COGS $${financialReport.totalCostOfGoodsSold.toFixed(2)}, Profit $${financialReport.totalGrossProfit.toFixed(2)}, Margin ${financialReport.grossProfitMarginPct}%`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 3: Product Performance & Margins Ranking
  // ---------------------------------------------------------------------------
  console.log('\n--- 3. Product Performance & Margin Ranking ---');

  // Completed sales breakdown:
  // Beans: 1 unit sold, Gross $16.00, Cost $9.00, Profit $7.00 (margin 43.8%)
  // Latte: 2 units sold, Gross $11.00, Cost $3.00, Profit $8.00 (margin 72.7%)
  // Croissant: 3 units sold (1 in sale_001 + 2 in sale_004), Gross $10.50, Cost $3.00, Profit $7.50 (margin 71.4%)
  const topProduct = financialReport.topProducts[0];
  assertTest(
    topProduct.productId === 'prod_beans' && topProduct.grossSales === 16.00,
    'Top Product by Revenue',
    'Top product: prod_beans with $16.00 gross revenue',
    `Top product: ${topProduct.productId} (${topProduct.name}) with $${topProduct.grossSales.toFixed(2)}`
  );

  const croissantPerf = financialReport.topProducts.find(p => p.productId === 'prod_croissant');
  assertTest(
    croissantPerf !== undefined && croissantPerf.unitsSold === 3 && croissantPerf.grossProfit === 7.50,
    'Product Units and Profit Accuracy (Croissant)',
    '3 units sold, $7.50 profit',
    croissantPerf ? `${croissantPerf.unitsSold} units, $${croissantPerf.grossProfit.toFixed(2)} profit` : 'Not found'
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 4: Payment Tender Breakdown & Transaction Shares
  // ---------------------------------------------------------------------------
  console.log('\n--- 4. Payment Tender Distribution ---');

  // Payments across all 4 sales:
  // Cash: sale_001 ($15.95) + sale_003 ($6.05) = $22.00 (2 txns)
  // Card: sale_002 ($17.60) = $17.60 (1 txn)
  // Mobile: sale_004 ($7.70) = $7.70 (1 txn)
  // Total pay: 22.00 + 17.60 + 7.70 = 47.30
  // Cash share: (22.00 / 47.30) * 100 = ~46.5%
  const cashTender = financialReport.paymentBreakdown.find(p => p.method === 'Cash');
  const cardTender = financialReport.paymentBreakdown.find(p => p.method === 'Card');
  assertTest(
    cashTender !== undefined && cashTender.amount === 22.00 && cashTender.transactionCount === 2,
    'Cash Tender Metric Calculation',
    'Cash amount $22.00 across 2 transactions',
    cashTender ? `Cash $${cashTender.amount.toFixed(2)} across ${cashTender.transactionCount} transactions (${cashTender.percentageShare}%)` : 'Not found'
  );

  assertTest(
    cardTender !== undefined && cardTender.amount === 17.60 && cardTender.transactionCount === 1,
    'Card Tender Metric Calculation',
    'Card amount $17.60 across 1 transaction',
    cardTender ? `Card $${cardTender.amount.toFixed(2)} across ${cardTender.transactionCount} transactions (${cardTender.percentageShare}%)` : 'Not found'
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 5: Refund Analytics & Reason Grouping
  // ---------------------------------------------------------------------------
  console.log('\n--- 5. Refund Analytics & Metrics ---');

  // Sale_003 is refunded: total $6.05, notes: "Customer dropped beverage"
  // Total tickets = 4. Refund count = 1. Refund rate = 25.0%.
  assertTest(
    financialReport.refundMetrics.totalRefundedAmount === 6.05 &&
    financialReport.refundMetrics.refundCount === 1 &&
    financialReport.refundMetrics.refundRatePct === 25.0,
    'Refund Amount and Rate Aggregation',
    'Total refunded $6.05, 1 count, 25.0% rate',
    `Refunded $${financialReport.refundMetrics.totalRefundedAmount.toFixed(2)}, ${financialReport.refundMetrics.refundCount} tickets, rate ${financialReport.refundMetrics.refundRatePct}%`
  );

  assertTest(
    financialReport.refundMetrics.byReason['Customer dropped beverage'] !== undefined &&
    financialReport.refundMetrics.byReason['Customer dropped beverage'].amount === 6.05,
    'Refund Categorization by Reason Note',
    'Reason "Customer dropped beverage" with $6.05',
    JSON.stringify(financialReport.refundMetrics.byReason)
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 6: Cash Drawer Shift Discrepancy Audits
  // ---------------------------------------------------------------------------
  console.log('\n--- 6. Cash Drawer Discrepancy Audits ---');

  const mockShifts = [
    // Shift 1: Balanced within $0.05
    {
      id: 'shift_01',
      terminalId: 'term_01',
      terminalName: 'Main Terminal',
      employeeId: 'emp_maria',
      employeeName: 'Maria Santos',
      openedAt: '2026-10-12T07:00:00Z',
      openingFloat: 200.00,
      cashSales: 150.00,
      expectedCash: 350.00,
      actualCash: 350.02, // diff +0.02 => balanced
      payIns: 0,
      payOuts: 0
    },
    // Shift 2: Over by $15.00
    {
      id: 'shift_02',
      terminalId: 'term_01',
      terminalName: 'Main Terminal',
      employeeId: 'emp_carlos',
      employeeName: 'Carlos Ramos',
      openedAt: '2026-10-12T15:00:00Z',
      openingFloat: 200.00,
      cashSales: 220.00,
      expectedCash: 420.00,
      actualCash: 435.00, // diff +15.00 => over
      payIns: 0,
      payOuts: 0
    },
    // Shift 3: Short by $10.00
    {
      id: 'shift_03',
      terminalId: 'term_02',
      terminalName: 'Patio Terminal',
      employeeId: 'emp_maria',
      employeeName: 'Maria Santos',
      openedAt: '2026-10-11T08:00:00Z',
      openingFloat: 150.00,
      cashSales: 100.00,
      expectedCash: 250.00,
      actualCash: 240.00, // diff -10.00 => short
      payIns: 0,
      payOuts: 0
    }
  ];

  const shiftAuditReport = ReportingService.generateFinancialReport(
    sampleSales,
    products,
    categories,
    employees,
    mockShifts,
    allRangeFilter
  );

  const balancedShift = shiftAuditReport.cashDiscrepancies.find(s => s.shiftId === 'shift_01');
  const overShift = shiftAuditReport.cashDiscrepancies.find(s => s.shiftId === 'shift_02');
  const shortShift = shiftAuditReport.cashDiscrepancies.find(s => s.shiftId === 'shift_03');

  assertTest(
    balancedShift?.status === 'balanced' &&
    overShift?.status === 'over' &&
    shortShift?.status === 'short',
    'Cash Discrepancy Status Thresholds',
    'shift_01: balanced, shift_02: over, shift_03: short',
    `shift_01: ${balancedShift?.status}, shift_02: ${overShift?.status}, shift_03: ${shortShift?.status}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 7: Inventory Valuation & Threshold Alerts
  // ---------------------------------------------------------------------------
  console.log('\n--- 7. Inventory Valuation Summary ---');

  // Tracked products:
  // Latte: stock 40, cost 1.50, price 5.50 -> retail 220.00, cost 60.00
  // Croissant: stock 8, cost 1.00, price 3.50 -> retail 28.00, cost 8.00 (LOW STOCK: 8 <= 10)
  // Beans: stock 0, cost 9.00, price 18.00 -> retail 0.00, cost 0.00 (OUT OF STOCK: 0 <= 0)
  // (Mug is untracked)
  // Total units: 40 + 8 + 0 = 48
  // Total retail: 220.00 + 28.00 + 0.00 = 248.00
  // Total cost: 60.00 + 8.00 + 0.00 = 68.00
  // Potential profit: 248.00 - 68.00 = 180.00
  // Overall margin: (180.00 / 248.00) * 100 = 72.6%
  const valuation = InventoryService.getValuationSummary(products);

  assertTest(
    valuation.totalTrackedProducts === 3 &&
    valuation.totalUnitsInStock === 48 &&
    valuation.totalRetailValue === 248.00 &&
    valuation.totalCostValue === 68.00 &&
    valuation.potentialGrossProfit === 180.00 &&
    valuation.overallMarginPct === 72.6,
    'Inventory Valuation Calculation',
    '48 units, $248.00 retail, $68.00 cost, $180.00 profit, 72.6% margin',
    `${valuation.totalUnitsInStock} units, $${valuation.totalRetailValue.toFixed(2)} retail, $${valuation.totalCostValue.toFixed(2)} cost, $${valuation.potentialGrossProfit.toFixed(2)} profit, ${valuation.overallMarginPct}% margin`
  );

  assertTest(
    valuation.lowStockItemsCount === 1 && valuation.outOfStockItemsCount === 1,
    'Low Stock and Out of Stock Alert Counters',
    '1 low stock item, 1 out of stock item',
    `Low stock: ${valuation.lowStockItemsCount}, Out of stock: ${valuation.outOfStockItemsCount}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 8: Physical Stock Count Session & Reconciliation Ledger
  // ---------------------------------------------------------------------------
  console.log('\n--- 8. Physical Stock Count & Variance Reconciliation ---');

  // Create count session:
  // Latte: counted 38 (expected 40, variance -2 units, -$3.00)
  // Croissant: counted 12 (expected 8, variance +4 units, +$4.00)
  // Beans: counted 5 (expected 0, variance +5 units, +$45.00)
  const initialCountItems: StockCountItem[] = [
    {
      productId: 'prod_latte',
      productName: 'Caramel Oat Latte',
      sku: 'LAT-OAT-CAR',
      systemExpectedStock: 40,
      countedStock: 38,
      varianceUnits: -2,
      unitCost: 1.50,
      varianceValue: -3.00
    },
    {
      productId: 'prod_croissant',
      productName: 'Butter Croissant',
      sku: 'BAK-CRO-BUT',
      systemExpectedStock: 8,
      countedStock: 12,
      varianceUnits: 4,
      unitCost: 1.00,
      varianceValue: 4.00
    },
    {
      productId: 'prod_beans',
      productName: 'House Blend Beans 500g',
      sku: 'RET-BEA-500',
      systemExpectedStock: 0,
      countedStock: 5,
      varianceUnits: 5,
      unitCost: 9.00,
      varianceValue: 45.00
    }
  ];

  const session = InventoryService.createStockCountSession(
    storeId,
    'Carlos Ramos',
    'Q4 Store Audit',
    initialCountItems
  );

  assertTest(
    session.status === 'draft' && session.items.length === 3,
    'Create Draft Stock Count Session',
    'Session created in draft status with 3 count items',
    `Status: ${session.status}, Items: ${session.items.length}`
  );

  // Commit session reconciliation
  const reconciliation = InventoryService.commitStockCountSession(session.id, 'Carlos Ramos');

  const updatedLatte = reconciliation.products.find(p => p.id === 'prod_latte');
  const updatedCroissant = reconciliation.products.find(p => p.id === 'prod_croissant');
  const updatedBeans = reconciliation.products.find(p => p.id === 'prod_beans');

  assertTest(
    updatedLatte?.stock === 38 &&
    updatedCroissant?.stock === 12 &&
    updatedBeans?.stock === 5,
    'Reconciliation Updates Live Product Stock',
    'Latte stock 38, Croissant stock 12, Beans stock 5',
    `Latte: ${updatedLatte?.stock}, Croissant: ${updatedCroissant?.stock}, Beans: ${updatedBeans?.stock}`
  );

  const countMovements = reconciliation.movements.filter(m => m.type === 'count');
  assertTest(
    countMovements.length >= 3 && countMovements.some(m => m.productId === 'prod_beans' && m.quantity === 5),
    'Audit Movements Created for Stock Reconciliation',
    'Audit movements recorded with type "count"',
    `${countMovements.length} count movements created: [${countMovements.map(m => `${m.sku}:${m.quantity}`).join(', ')}]`
  );

  assertTest(
    reconciliation.session.status === 'completed' && reconciliation.session.totalVarianceUnits === 7,
    'Stock Count Session Status and Total Variance',
    'Status completed, total variance units 7 (-2 + 4 + 5 = 7)',
    `Status: ${reconciliation.session.status}, Variance Units: ${reconciliation.session.totalVarianceUnits}`
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 9: Supplier Directory & Purchase Order Workflow
  // ---------------------------------------------------------------------------
  console.log('\n--- 9. Supplier Directory & Purchase Order Workflow ---');

  // Create Supplier
  const supplier: Supplier = {
    id: `sup_andes_roasters`,
    storeId,
    name: 'Andes Direct Coffee Importers',
    contactPerson: 'Mateo Morales',
    email: 'orders@andescoffee.com',
    phone: '+1 555-019-2834',
    address: '450 Industrial Way, Seattle WA',
    leadTimeDays: 3,
    active: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  const suppliers = StorageService.getSuppliers();
  suppliers.push(supplier);
  StorageService.saveSuppliers(suppliers);

  assertTest(
    StorageService.getSuppliers().length === 1 && StorageService.getSuppliers()[0].name === 'Andes Direct Coffee Importers',
    'Supplier Creation & Storage',
    '1 supplier stored with name "Andes Direct Coffee Importers"',
    `Suppliers count: ${StorageService.getSuppliers().length}, Name: ${StorageService.getSuppliers()[0]?.name}`
  );

  // Create PO for Beans (10 units @ $8.50 unit cost)
  const po = InventoryService.createPurchaseOrder({
    storeId,
    supplierId: supplier.id,
    supplierName: supplier.name,
    poNumber: 'PO-2026-1001',
    status: 'ordered',
    orderDate: new Date().toISOString(),
    expectedDate: new Date(Date.now() + 3 * 86400000).toISOString(),
    items: [
      {
        id: 'poi_beans_10',
        productId: 'prod_beans',
        productName: 'House Blend Beans 500g',
        sku: 'RET-BEA-500',
        quantityOrdered: 10,
        quantityReceived: 0,
        unitCost: 8.50,
        totalCost: 85.00
      }
    ],
    totalAmount: 85.00,
    createdBy: 'Carlos Ramos'
  });

  assertTest(
    po.status === 'ordered' && po.totalAmount === 85.00 && po.poNumber === 'PO-2026-1001',
    'Purchase Order Created in Ordered State',
    'Status ordered, total $85.00, PO-2026-1001',
    `Status: ${po.status}, Amount: $${po.totalAmount.toFixed(2)}, Number: ${po.poNumber}`
  );

  // Current stock of beans after reconciliation was 5
  // When receiving PO (10 units), beans stock must increment to 5 + 10 = 15, and unit cost updated to 8.50
  const poReceipt = InventoryService.receivePurchaseOrder(po.id, 'Carlos Ramos');
  const receivedBeans = poReceipt.products.find(p => p.id === 'prod_beans');

  assertTest(
    poReceipt.order.status === 'received' &&
    receivedBeans?.stock === 15 &&
    receivedBeans?.cost === 8.50,
    'Receive Purchase Order Increments Stock & Cost',
    'PO status "received", Beans stock 15, unit cost $8.50',
    `PO Status: ${poReceipt.order.status}, Beans Stock: ${receivedBeans?.stock}, Cost: $${receivedBeans?.cost.toFixed(2)}`
  );

  const purchaseMovement = poReceipt.movements.find(m => m.type === 'purchase' && m.referenceId === po.id);
  assertTest(
    purchaseMovement !== undefined && purchaseMovement.quantity === 10 && purchaseMovement.previousQuantity === 5 && purchaseMovement.newQuantity === 15,
    'Purchase Movement Ledger Logged Correctly',
    'Type purchase, delta +10, prev 5, new 15',
    purchaseMovement ? `Type: ${purchaseMovement.type}, Delta: ${purchaseMovement.quantity}, Prev: ${purchaseMovement.previousQuantity}, New: ${purchaseMovement.newQuantity}` : 'Not found'
  );

  // ---------------------------------------------------------------------------
  // TEST SUITE 10: RFC 4180 CSV Exports & Thermal Z-Report Output
  // ---------------------------------------------------------------------------
  console.log('\n--- 10. RFC 4180 CSV Exports & Z-Report Thermal Format ---');

  // 10.1 Financial CSV Export
  const financialCsv = ReportingService.generateFinancialCsv(financialReport);
  assertTest(
    financialCsv.includes('AuraPOS — Executive Financial & Sales Report') &&
    financialCsv.includes('KEY FINANCIAL METRICS,Value (USD)') &&
    financialCsv.includes('PRODUCT PERFORMANCE RANKING') &&
    financialCsv.includes('PAYMENT METHODS DISTRIBUTION') &&
    financialCsv.includes('\r\n'),
    'Financial Report RFC 4180 CSV Export Structure',
    'Contains executive headers, key metrics, product ranking, CRLF line endings',
    `Length: ${financialCsv.length} chars, CRLF present: ${financialCsv.includes('\r\n')}`
  );

  // 10.2 Inventory Valuation CSV Export
  const valuationCsv = InventoryService.generateInventoryValuationCsv(poReceipt.products, categories);
  assertTest(
    valuationCsv.includes('AuraPOS — Inventory Valuation & Stock Audit Report') &&
    valuationCsv.includes('VALUATION SUMMARY,Value (USD)') &&
    valuationCsv.includes('INVENTORY MASTER ITEM LEDGER') &&
    valuationCsv.includes('RET-BEA-500'),
    'Inventory Valuation RFC 4180 CSV Export Structure',
    'Contains valuation headers, master item ledger, product SKUs',
    `Length: ${valuationCsv.length} chars, Contains Beans: ${valuationCsv.includes('RET-BEA-500')}`
  );

  // 10.3 Stock Movements CSV Export
  const movementsCsv = InventoryService.generateMovementsCsv(poReceipt.movements);
  assertTest(
    movementsCsv.includes('AuraPOS — Historical Stock Movement Ledger') &&
    movementsCsv.includes('Movement Type,Qty Delta,Previous Qty,New Qty') &&
    movementsCsv.includes('PURCHASE'),
    'Historical Movements RFC 4180 CSV Export Structure',
    'Contains movement ledger headers, purchase types, quantities',
    `Length: ${movementsCsv.length} chars, Contains PURCHASE: ${movementsCsv.includes('PURCHASE')}`
  );

  // 10.4 Thermal End-of-Day Z-Report Formatting
  const zReport = ReportingService.formatEndOfDayZReport(financialReport, 'AuraPOS Flagship Store');
  assertTest(
    zReport.includes('AURAPOS FLAGSHIP STORE') &&
    zReport.includes('END-OF-DAY FINANCIAL Z-REPORT') &&
    zReport.includes('FINANCIAL SUMMARY:') &&
    zReport.includes('Gross Sales:') &&
    zReport.includes('Net Sales:') &&
    zReport.includes('PAYMENT TENDER BREAKDOWN:') &&
    zReport.includes('*** END OF REPORT ***'),
    'Thermal Printable Z-Report Layout & Content',
    'Contains store header, Z-report title, financial totals, tender breakdown, closing marker',
    `Report Length: ${zReport.length} chars, Header present: ${zReport.includes('AURAPOS FLAGSHIP STORE')}`
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n----------------------------------------------------------------------');
  console.log(`TOTAL PHASE 7 TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('----------------------------------------------------------------------\n');

  if (failedCount > 0) {
    throw new Error(`${failedCount} Phase 7 test(s) failed.`);
  }
}

// Cross-platform entrypoint execution
const isDirectRun = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.includes(path.basename(process.argv[1]))
);

if (isDirectRun) {
  runPhase7Tests().catch(err => {
    console.error('Phase 7 test runner encountered fatal error:', err);
    process.exit(1);
  });
}
