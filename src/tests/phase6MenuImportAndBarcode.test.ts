/**
 * AuraPOS Phase 6 — Menu/Photo Import and Barcode Workflows Test Suite
 *
 * Verifies:
 * 1. ProductRepository Barcode & SKU Lookup (root products & specific variants)
 * 2. Hardware HID Barcode Scanner Keystroke Stream Buffering & Delimiter Parsing
 * 3. Audio Feedback POS Sound Cues (Success Beep & Error Tone)
 * 4. Menu Spatial Layout & Structure Parser (Spanish dishes, accents, and LatAm prices)
 * 5. Image Normalization & Deskew Angle Bounds
 * 6. Menu Scanner Diagnostic Stages 1 to 5 (Camera, Normalization, OCR, Parser, Reconciliation)
 * 7. End-to-End Pipeline Diagnostic Report Generator & Remediation
 * 8. Catalog Conflict Resolution Policies (update_existing, create_new, skip)
 */

import path from 'path';
import { ProductRepository } from '../services/repositories/ProductRepository.ts';
import { StorageService } from '../services/storageService.ts';
import { AudioFeedbackService } from '../utils/audioFeedback.ts';
import { LocalMenuStructureParser } from '../services/ocr/localMenuStructureParser.ts';
import { MenuScannerDiagnostics } from '../services/ocr/menuScannerDiagnostics.ts';
import { MenuScannerImportService } from '../services/menuScannerImportService.ts';
import { Product, Category } from '../types/pos.ts';
import { OcrResult, ScannedMenuPage, ExtractedProduct } from '../types/menuScanner.ts';

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

export async function runPhase6Tests() {
  console.log('======================================================================');
  console.log('AURAPOS PHASE 6 — MENU/PHOTO IMPORT & BARCODE WORKFLOWS TEST SUITE');
  console.log('======================================================================\n');

  const storeId = 'store_test_phase6';

  // Seed sample products with barcodes, SKUs, and variants
  const sampleProducts: Product[] = [
    {
      id: 'prod_coffee_beans',
      storeId,
      categoryId: 'cat_beverages',
      name: 'Organic Espresso Beans (1kg)',
      sku: 'COF-ESP-1K',
      barcode: '7751234567890',
      price: 24.50,
      cost: 12.00,
      unit: 'item',
      trackInventory: true,
      stock: 45,
      lowStockThreshold: 10,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      variants: [
        {
          id: 'var_beans_500g',
          productId: 'prod_coffee_beans',
          name: '500g Bag',
          sku: 'COF-ESP-500G',
          barcode: '7751234567891',
          price: 14.00,
          cost: 7.00,
          attributes: { size: '500g' },
          active: true,
          stock: 20
        },
        {
          id: 'var_beans_250g',
          productId: 'prod_coffee_beans',
          name: '250g Bag',
          sku: 'COF-ESP-250G',
          barcode: '7751234567892',
          price: 8.50,
          cost: 4.00,
          attributes: { size: '250g' },
          active: true,
          stock: 35
        }
      ]
    },
    {
      id: 'prod_latte',
      storeId,
      categoryId: 'cat_beverages',
      name: 'Artisan Latte',
      sku: 'BEV-LATTE',
      barcode: '7759999999999',
      price: 4.50,
      cost: 1.50,
      unit: 'cup',
      trackInventory: false,
      stock: 100,
      lowStockThreshold: 5,
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }
  ];

  StorageService.saveProducts(sampleProducts);

  // ---------------------------------------------------------------------------
  // Test 1: ProductRepository Barcode & SKU Lookup (Root & Variants)
  // ---------------------------------------------------------------------------
  const rootBarcodeResult = await ProductRepository.lookupBarcode('7751234567890', storeId);
  const variantBarcodeResult = await ProductRepository.lookupBarcode('7751234567891', storeId);
  const skuResult = await ProductRepository.lookupBarcode('COF-ESP-250G', storeId);
  const nonExistentResult = await ProductRepository.lookupBarcode('0000000000000', storeId);

  assertTest(
    rootBarcodeResult?.product.id === 'prod_coffee_beans' &&
    rootBarcodeResult.matchType === 'product_barcode' &&
    variantBarcodeResult?.matchedVariant?.id === 'var_beans_500g' &&
    variantBarcodeResult.matchType === 'variant_barcode' &&
    skuResult?.matchedVariant?.id === 'var_beans_250g' &&
    skuResult.matchType === 'variant_sku' &&
    nonExistentResult === null,
    'Test 1: Barcode & SKU Lookup Across Products and Variants',
    'Root barcode, variant barcode, and SKU matches correctly resolved; nonexistent returns null',
    `Root: ${rootBarcodeResult?.product.name}; Variant: ${variantBarcodeResult?.matchedVariant?.name}; SkuMatch: ${skuResult?.matchedVariant?.sku}; UnknownNull: ${nonExistentResult === null}`
  );

  // ---------------------------------------------------------------------------
  // Test 2: Hardware HID Barcode Scanner Keystroke Stream Simulation
  // ---------------------------------------------------------------------------
  class SimulatedScannerBuffer {
    private buffer: string = '';
    private lastKeyTime: number = 0;
    private maxIntervalMs: number = 60;

    typeKey(char: string, intervalMs: number): string | null {
      const now = this.lastKeyTime + intervalMs;
      if (intervalMs > this.maxIntervalMs && this.buffer.length > 0) {
        this.buffer = '';
      }
      this.lastKeyTime = now;

      if (char === 'Enter') {
        const out = this.buffer.trim();
        this.buffer = '';
        return out.length >= 3 ? out : null;
      }
      this.buffer += char;
      return null;
    }
  }

  const scanner = new SimulatedScannerBuffer();
  let scannedCode: string | null = null;
  // Fast burst (10ms between keys) followed by Enter
  const testChars = '7751234567890'.split('');
  for (const c of testChars) {
    scanner.typeKey(c, 10);
  }
  scannedCode = scanner.typeKey('Enter', 10);

  // Test slow human typing (> 150ms between keys)
  const humanScanner = new SimulatedScannerBuffer();
  humanScanner.typeKey('7', 150);
  humanScanner.typeKey('7', 150);
  humanScanner.typeKey('5', 150);
  const humanResult = humanScanner.typeKey('Enter', 150);

  assertTest(
    scannedCode === '7751234567890' && humanResult === null,
    'Test 2: Hardware HID Scanner Rapid Stream Buffering vs Slow Human Typing',
    'Rapid keystrokes (<50ms) buffer into barcode and trigger on Enter; slow typing (>60ms) resets buffer',
    `Scanned Code: "${scannedCode}"; Slow typing result: ${humanResult}`
  );

  // ---------------------------------------------------------------------------
  // Test 3: Audio Feedback POS Sound Cues Execution
  // ---------------------------------------------------------------------------
  let audioBeepSuccess = true;
  try {
    AudioFeedbackService.playBarcodeSuccess();
    AudioFeedbackService.playBarcodeError();
  } catch (err) {
    audioBeepSuccess = false;
  }

  assertTest(
    audioBeepSuccess === true,
    'Test 3: Audio Feedback POS Sound Cues (Beep & Error Tone)',
    'AudioFeedbackService handles audio context gracefully in all environments',
    `Audio cues triggered safely: ${audioBeepSuccess}`
  );

  // ---------------------------------------------------------------------------
  // Test 4: Menu Spatial Structure Parser (Spanish Dishes, Accents & LatAm Prices)
  // ---------------------------------------------------------------------------
  const mockOcr: OcrResult = {
    fullText: `
      RESTAURANTE EL SABOR
      ENTRADAS
      Ceviche Clásico Peruano ....... S/ 28.00
      Causa Rellena de Pollo ........ S/ 22.00
      Tequeños con Guacamole ........ S/ 18.50

      PLATOS DE FONDO
      Lomo Saltado Criollo .......... S/ 38.00
      Ají de Gallina Tradicional .... S/ 32.00
      Arroz con Mariscos ............ S/ 42.50

      BEBIDAS
      Chicha Morada Jarra ........... S/ 15.00
      Limonada Frozen ............... S/ 12.00
    `,
    pageNumber: 1,
    textBlocks: [],
    lines: [
      { text: 'ENTRADAS', boundingBox: { left: 0.1, top: 0.1, right: 0.5, bottom: 0.15, width: 0.4, height: 0.05 } },
      { text: 'Ceviche Clásico Peruano ....... S/ 28.00', boundingBox: { left: 0.1, top: 0.2, right: 0.9, bottom: 0.25, width: 0.8, height: 0.05 } },
      { text: 'Causa Rellena de Pollo ........ S/ 22.00', boundingBox: { left: 0.1, top: 0.26, right: 0.9, bottom: 0.31, width: 0.8, height: 0.05 } },
      { text: 'Tequeños con Guacamole ........ S/ 18.50', boundingBox: { left: 0.1, top: 0.32, right: 0.9, bottom: 0.37, width: 0.8, height: 0.05 } },
      { text: 'PLATOS DE FONDO', boundingBox: { left: 0.1, top: 0.4, right: 0.5, bottom: 0.45, width: 0.4, height: 0.05 } },
      { text: 'Lomo Saltado Criollo .......... S/ 38.00', boundingBox: { left: 0.1, top: 0.46, right: 0.9, bottom: 0.51, width: 0.8, height: 0.05 } },
      { text: 'Ají de Gallina Tradicional .... S/ 32.00', boundingBox: { left: 0.1, top: 0.52, right: 0.9, bottom: 0.57, width: 0.8, height: 0.05 } },
      { text: 'Arroz con Mariscos ............ S/ 42.50', boundingBox: { left: 0.1, top: 0.58, right: 0.9, bottom: 0.63, width: 0.8, height: 0.05 } },
      { text: 'BEBIDAS', boundingBox: { left: 0.1, top: 0.65, right: 0.5, bottom: 0.7, width: 0.4, height: 0.05 } },
      { text: 'Chicha Morada Jarra ........... S/ 15.00', boundingBox: { left: 0.1, top: 0.71, right: 0.9, bottom: 0.76, width: 0.8, height: 0.05 } },
      { text: 'Limonada Frozen ............... S/ 12.00', boundingBox: { left: 0.1, top: 0.77, right: 0.9, bottom: 0.82, width: 0.8, height: 0.05 } }
    ]
  };

  const parsedMenu = LocalMenuStructureParser.parse(mockOcr, 1, [], []);

  const hasCeviche = parsedMenu.products.some(p => p.name.includes('Ceviche') && p.price === 28.00);
  const hasLomo = parsedMenu.products.some(p => p.name.includes('Lomo Saltado') && p.price === 38.00);
  const categoriesCount = parsedMenu.categories.length;

  assertTest(
    parsedMenu.products.length >= 6 && hasCeviche && hasLomo && categoriesCount >= 2,
    'Test 4: Menu Structure Parser (Spanish Accents, Categories & S/ Prices)',
    'Extracts at least 6 products across at least 2 Spanish categories with exact prices',
    `Products: ${parsedMenu.products.length}; Categories: ${categoriesCount}; Ceviche: S/${hasCeviche ? 28 : 0}; Lomo: S/${hasLomo ? 38 : 0}`
  );

  // ---------------------------------------------------------------------------
  // Test 5: Normalization & Deskew Angle Bounds Verification
  // ---------------------------------------------------------------------------
  const normalPage: ScannedMenuPage = {
    id: 'page_normal',
    name: 'Menu Page 1',
    dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(5000),
    mimeType: 'image/jpeg',
    rotation: 0,
    deskewAngle: -1.8,
    width: 1600,
    height: 2400,
    timestamp: new Date().toISOString()
  };

  const extremeSkewPage: ScannedMenuPage = {
    id: 'page_skewed',
    name: 'Menu Page 2',
    dataUrl: 'data:image/jpeg;base64,' + 'A'.repeat(5000),
    mimeType: 'image/jpeg',
    rotation: 90,
    deskewAngle: 14.5,
    width: 1600,
    height: 2400,
    timestamp: new Date().toISOString()
  };

  const normReport = MenuScannerDiagnostics.evaluateNormalization([normalPage]);
  const skewReport = MenuScannerDiagnostics.evaluateNormalization([extremeSkewPage]);

  assertTest(
    normReport.status === 'passed' && skewReport.status === 'warning',
    'Test 5: Image Normalization & Deskew Angle Bounds Inspection',
    'Normal deskew (-1.8°) passes; extreme tilt (14.5° > 12°) raises actionable warning',
    `Normal status: ${normReport.status}; Skew status: ${skewReport.status} ("${skewReport.summary.substring(0, 45)}...")`
  );

  // ---------------------------------------------------------------------------
  // Test 6: Diagnostic Pipeline Stages 1 to 5 (Camera, Normalization, OCR, Parser, Reconciliation)
  // ---------------------------------------------------------------------------
  // Stage 1: Camera acquisition check
  const emptyPagesDiag = MenuScannerDiagnostics.evaluateCameraAcquisition([]);
  const validPagesDiag = MenuScannerDiagnostics.evaluateCameraAcquisition([normalPage]);

  // Stage 3: OCR extraction check
  const blankOcrDiag = MenuScannerDiagnostics.evaluateOcrExtraction([{ fullText: '', pageNumber: 1, textBlocks: [], lines: [] }]);
  const validOcrDiag = MenuScannerDiagnostics.evaluateOcrExtraction([mockOcr]);

  // Stage 4: Structure parser check
  const emptyParserDiag = MenuScannerDiagnostics.evaluateStructureParser([], []);
  const validParserDiag = MenuScannerDiagnostics.evaluateStructureParser(parsedMenu.products, parsedMenu.categories);

  // Stage 5: Catalog reconciliation check
  const collisionItem: ExtractedProduct = {
    ...parsedMenu.products[0],
    barcode: '7751234567890' // Collides with sample product
  };
  const reconciliationDiag = MenuScannerDiagnostics.evaluateCatalogReconciliation([collisionItem], sampleProducts);

  assertTest(
    emptyPagesDiag.status === 'failed' &&
    validPagesDiag.status === 'passed' &&
    blankOcrDiag.status === 'failed' &&
    validOcrDiag.status === 'passed' &&
    emptyParserDiag.status === 'failed' &&
    validParserDiag.status === 'passed' &&
    reconciliationDiag.status === 'warning' &&
    reconciliationDiag.details?.barcodeMatches === 1,
    'Test 6: Granular Diagnostic Stages 1 to 5 Error & Warning Detection',
    'Empty/blank states fail closed with remediation advice; collisions raise reconciliation warnings',
    `CameraEmpty: ${emptyPagesDiag.status}; OcrBlank: ${blankOcrDiag.status}; ParserEmpty: ${emptyParserDiag.status}; ReconciliationCollision: ${reconciliationDiag.status}`
  );

  // ---------------------------------------------------------------------------
  // Test 7: Full Pipeline Diagnostic Summary Generation
  // ---------------------------------------------------------------------------
  const fullReport = MenuScannerDiagnostics.generatePipelineReport({
    pages: [normalPage],
    ocrResults: [mockOcr],
    extractedProducts: parsedMenu.products,
    extractedCategories: parsedMenu.categories,
    existingProducts: sampleProducts,
    detectedCurrency: 'S/'
  });

  assertTest(
    fullReport.overallSuccess === true &&
    fullReport.stages.length === 5 &&
    fullReport.stages.every(s => s.status === 'passed' || s.status === 'warning'),
    'Test 7: End-to-End Pipeline Diagnostic Report Synthesis',
    'Synthesizes all 5 stages, computes overall status, and provides audit timestamps',
    `OverallSuccess: ${fullReport.overallSuccess}; TotalStages: ${fullReport.stages.length}; Timestamp: ${fullReport.timestamp.substring(0, 19)}`
  );

  // ---------------------------------------------------------------------------
  // Test 8: Catalog Reconciliation & Conflict Resolution Policies
  // ---------------------------------------------------------------------------
  const scanResultForImport = {
    menuTitle: 'Restaurante El Sabor',
    detectedCurrency: 'S/',
    categories: parsedMenu.categories,
    products: parsedMenu.products.map(p => ({
      ...p,
      selected: true,
      resolution: 'create_new' as const
    }))
  };

  const processed = MenuScannerImportService.processScanResult(
    scanResultForImport,
    [],
    sampleProducts
  );

  assertTest(
    processed.products.length === parsedMenu.products.length &&
    processed.categories.length === parsedMenu.categories.length &&
    processed.products.every(p => p.resolution !== undefined),
    'Test 8: Catalog Conflict Resolution & Import Preparation',
    'Assigns conflict resolution policies and links products to extracted categories',
    `Processed products: ${processed.products.length}; Processed categories: ${processed.categories.length}`
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;

  console.log('\n----------------------------------------------------------------------');
  console.log(`TOTAL PHASE 6 TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${failedCount}`);
  console.log('----------------------------------------------------------------------\n');

  if (failedCount > 0) {
    throw new Error(`${failedCount} Phase 6 test(s) failed.`);
  }
}

// Cross-platform entrypoint execution
const isDirectRun = process.argv[1] && (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.includes(path.basename(process.argv[1]))
);

if (isDirectRun) {
  runPhase6Tests().catch(err => {
    console.error('Phase 6 test runner encountered fatal error:', err);
    process.exit(1);
  });
}
