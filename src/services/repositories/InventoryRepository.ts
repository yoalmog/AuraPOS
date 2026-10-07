import { supabase, isSupabaseConfigured } from '../supabase/supabaseClient.ts';
import { InventoryMovement } from '../../types/pos.ts';
import { StorageService } from '../storageService.ts';

export class InventoryRepository {
  /**
   * Get all inventory movements
   */
  static async getMovements(storeId: string = 'store_aura_main'): Promise<InventoryMovement[]> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('inventory_movements')
          .select('*')
          .eq('store_id', storeId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map(m => ({
            id: m.id,
            storeId: m.store_id,
            productId: m.product_id,
            productName: '',
            sku: '',
            type: m.type,
            quantity: Number(m.quantity),
            previousQuantity: 0,
            newQuantity: 0,
            reason: m.notes || '',
            referenceId: m.reference_id || undefined,
            employeeId: m.user_id || 'emp_owner',
            employeeName: 'Staff',
            createdAt: m.created_at
          }));
        }
      } catch (e: any) {
        console.warn('[InventoryRepository] Exception fetching movements:', e?.message);
      }
    }

    return StorageService.getInventoryMovements();
  }

  /**
   * Record movement-based stock adjustment
   */
  static async recordMovement(movement: InventoryMovement): Promise<InventoryMovement> {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('inventory_movements').insert({
          id: movement.id.length === 36 ? movement.id : undefined,
          store_id: movement.storeId || 'store_aura_main',
          product_id: movement.productId,
          type: movement.type,
          quantity: movement.quantity,
          reference_type: movement.type === 'sale' ? 'sale' : 'manual',
          reference_id: movement.referenceId || null,
          notes: movement.reason || null
        });

        // Also update the aggregated inventory level table
        const { data: invRow } = await supabase
          .from('inventory')
          .select('quantity')
          .eq('store_id', movement.storeId || 'store_aura_main')
          .eq('product_id', movement.productId)
          .single();

        const curQty = invRow ? Number(invRow.quantity) : 0;
        await supabase.from('inventory').upsert({
          store_id: movement.storeId || 'store_aura_main',
          product_id: movement.productId,
          quantity: curQty + movement.quantity
        });
      } catch (e: any) {
        console.warn('[InventoryRepository] Exception recording movement:', e?.message);
      }
    }

    const current = StorageService.getInventoryMovements();
    StorageService.saveInventoryMovements([movement, ...current]);
    return movement;
  }
}
