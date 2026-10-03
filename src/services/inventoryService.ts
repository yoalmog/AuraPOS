import { CartItem, Employee, InventoryMovement, Product } from '../types/pos.ts';
import { StorageService } from './storageService.ts';

export interface StockValidationResult {
  valid: boolean;
  errors: string[];
}

export class InventoryService {
  /**
   * Validates whether all items in the cart are in stock according to store policy.
   */
  static validateCartStock(items: CartItem[], allowNegativeStock = false): StockValidationResult {
    if (allowNegativeStock) {
      return { valid: true, errors: [] };
    }

    const allProducts = StorageService.getProducts();
    const productQtyMap = new Map<string, number>();

    // Accumulate total quantity per product across possible different variants or entries
    for (const item of items) {
      const current = productQtyMap.get(item.productId) || 0;
      productQtyMap.set(item.productId, current + item.quantity);
    }

    const errors: string[] = [];

    productQtyMap.forEach((qtyNeeded, productId) => {
      const product = allProducts.find(p => p.id === productId);
      if (product && product.trackInventory) {
        if (product.stock < qtyNeeded) {
          errors.push(
            `Insufficient stock for "${product.name}": ${product.stock} available, ${qtyNeeded} requested.`
          );
        }
      }
    });

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Applies inventory deductions atomically for a completed sale and generates audit movements.
   * Returns the updated products list and new inventory movements.
   */
  static deductStockForSale(
    items: CartItem[],
    saleId: string,
    receiptNumber: string,
    employee: Employee,
    storeId: string
  ): { products: Product[]; movements: InventoryMovement[] } {
    const allProducts = StorageService.getProducts();
    const allMovements = StorageService.getInventoryMovements();
    const nowIso = new Date().toISOString();
    const newMovements: InventoryMovement[] = [];

    // Accumulate requested deductions per product
    const qtyDeductions = new Map<string, number>();
    for (const item of items) {
      const current = qtyDeductions.get(item.productId) || 0;
      qtyDeductions.set(item.productId, current + item.quantity);
    }

    qtyDeductions.forEach((qtyToDeduct, productId) => {
      const pIndex = allProducts.findIndex(p => p.id === productId);
      if (pIndex !== -1) {
        const prod = allProducts[pIndex];
        if (prod.trackInventory) {
          const prevQty = prod.stock;
          const newQty = Math.max(0, prevQty - qtyToDeduct);

          allProducts[pIndex] = {
            ...prod,
            stock: newQty,
            updatedAt: nowIso
          };

          const movement: InventoryMovement = {
            id: `mov_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            storeId,
            productId: prod.id,
            productName: prod.name,
            sku: prod.sku,
            type: 'sale',
            quantity: -qtyToDeduct,
            previousQuantity: prevQty,
            newQuantity: newQty,
            reason: `POS Sale ${receiptNumber}`,
            referenceId: saleId,
            employeeId: employee.id,
            employeeName: employee.name,
            createdAt: nowIso
          };

          newMovements.push(movement);
        }
      }
    });

    // Save updated products and movements to storage
    StorageService.saveProducts(allProducts);
    if (newMovements.length > 0) {
      allMovements.unshift(...newMovements);
      StorageService.saveInventoryMovements(allMovements);
    }

    return { products: allProducts, movements: allMovements };
  }

  /**
   * Restores inventory for returned/refunded items.
   */
  static restoreStockForRefund(
    items: { productId: string; quantity: number; reason: string }[],
    refundId: string,
    receiptNumber: string,
    employee: Employee,
    storeId: string
  ): { products: Product[]; movements: InventoryMovement[] } {
    const allProducts = StorageService.getProducts();
    const allMovements = StorageService.getInventoryMovements();
    const nowIso = new Date().toISOString();
    const newMovements: InventoryMovement[] = [];

    items.forEach(item => {
      const pIndex = allProducts.findIndex(p => p.id === item.productId);
      if (pIndex !== -1) {
        const prod = allProducts[pIndex];
        if (prod.trackInventory) {
          const prevQty = prod.stock;
          const newQty = prevQty + item.quantity;

          allProducts[pIndex] = {
            ...prod,
            stock: newQty,
            updatedAt: nowIso
          };

          const movement: InventoryMovement = {
            id: `mov_ref_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            storeId,
            productId: prod.id,
            productName: prod.name,
            sku: prod.sku,
            type: 'refund',
            quantity: item.quantity,
            previousQuantity: prevQty,
            newQuantity: newQty,
            reason: `Refund for receipt ${receiptNumber}: ${item.reason}`,
            referenceId: refundId,
            employeeId: employee.id,
            employeeName: employee.name,
            createdAt: nowIso
          };

          newMovements.push(movement);
        }
      }
    });

    StorageService.saveProducts(allProducts);
    if (newMovements.length > 0) {
      allMovements.unshift(...newMovements);
      StorageService.saveInventoryMovements(allMovements);
    }

    return { products: allProducts, movements: allMovements };
  }

  /**
   * Manual stock adjustment
   */
  static adjustStock(
    productId: string,
    adjustmentType: 'add' | 'remove' | 'set',
    quantity: number,
    reason: string,
    employee: Employee
  ): void {
    const allProducts = StorageService.getProducts();
    const pIndex = allProducts.findIndex(p => p.id === productId);
    if (pIndex === -1) return;

    const prod = allProducts[pIndex];
    const prevQty = prod.stock;
    let newQty = prevQty;

    if (adjustmentType === 'add') {
      newQty = prevQty + quantity;
    } else if (adjustmentType === 'remove') {
      newQty = Math.max(0, prevQty - quantity);
    } else {
      newQty = Math.max(0, quantity);
    }

    const delta = newQty - prevQty;
    const nowIso = new Date().toISOString();

    allProducts[pIndex] = {
      ...prod,
      stock: newQty,
      updatedAt: nowIso
    };
    StorageService.saveProducts(allProducts);

    const movements = StorageService.getInventoryMovements();
    movements.unshift({
      id: `mov_adj_${Date.now()}`,
      storeId: StorageService.getSettings().id,
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku,
      type: 'adjustment',
      quantity: delta,
      previousQuantity: prevQty,
      newQuantity: newQty,
      reason,
      employeeId: employee.id,
      employeeName: employee.name,
      createdAt: nowIso
    });
    StorageService.saveInventoryMovements(movements);
  }
}
