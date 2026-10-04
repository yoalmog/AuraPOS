/**
 * AuraPOS - AI Menu Scanner Types & Data Contracts
 */

export interface ScannedMenuPage {
  id: string;
  name: string;
  dataUrl: string; // Base64 data URL
  mimeType: string;
  rotation: number; // 0, 90, 180, 270
  timestamp: string;
  fileSize?: number;
}

export interface ExtractedVariant {
  id: string;
  name: string; // e.g. "Small (12oz)", "Large (16oz)"
  price: number;
  sku?: string;
}

export interface ExtractedModifierOption {
  id: string;
  name: string; // e.g. "Extra Cheese", "Oat Milk"
  priceDelta: number; // e.g. 1.50
}

export interface ExtractedModifierGroup {
  id: string;
  name: string; // e.g. "Choice of Milk", "Add-ons", "Spice Level"
  required: boolean;
  min?: number;
  max?: number;
  options: ExtractedModifierOption[];
}

export type ConflictResolution = 'create_new' | 'update_existing' | 'skip';
export type CategoryConflictResolution = 'create_new' | 'merge_existing' | 'skip';

export interface ExtractedProduct {
  id: string;
  tempId: string;
  name: string;
  categoryName: string;
  categoryId?: string;
  price: number;
  cost: number;
  description: string;
  sku: string;
  barcode: string;
  unit: string;
  stock: number;
  lowStockThreshold: number;
  trackInventory: boolean;
  active: boolean;
  isFavorite: boolean;
  isSpicy?: boolean;
  isVegetarian?: boolean;
  isGlutenFree?: boolean;
  isAlcoholic?: boolean;
  imageUrl?: string;
  iconName?: string;
  color?: string;
  variants: ExtractedVariant[];
  modifiers: ExtractedModifierGroup[];
  pageIndex?: number;
  confidence?: number;
  selected: boolean;
  conflictType?: 'none' | 'name_match' | 'sku_match' | 'barcode_match';
  conflictExistingId?: string;
  resolution: ConflictResolution;
}

export interface ExtractedCategory {
  id: string;
  tempId: string;
  name: string;
  description?: string;
  color: string;
  iconName: string;
  sortOrder: number;
  active: boolean;
  autoPrintKitchen: boolean;
  printerId?: string;
  productCount: number;
  selected: boolean;
  conflictExistingId?: string;
  resolution: CategoryConflictResolution;
}

export interface MenuScanResult {
  menuTitle?: string;
  detectedCurrency?: string;
  confidenceScore?: number;
  notes?: string;
  categories: ExtractedCategory[];
  products: ExtractedProduct[];
}

export interface ImportSummary {
  totalImportedProducts: number;
  totalUpdatedProducts: number;
  totalImportedCategories: number;
  totalUpdatedCategories: number;
  createdCategoryNames: string[];
  createdProductNames: string[];
  updatedProductNames: string[];
  timestamp: string;
}

export type MenuScannerStep = 'capture' | 'analyzing' | 'review' | 'imported';
