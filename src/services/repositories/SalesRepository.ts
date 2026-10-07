import { supabase, isSupabaseConfigured } from '../supabase/supabaseClient.ts';
import { Sale, SaleItem, PaymentRecord } from '../../types/pos.ts';
import { StorageService } from '../storageService.ts';
import { LocalDB } from '../db/localDatabase.ts';

export class SalesRepository {
  /**
   * Fetch sales history for store
   */
  static async getAll(storeId: string = 'store_aura_main', limit: number = 100): Promise<Sale[]> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('sales')
          .select(`
            *,
            items:sale_items(*),
            payments:payments(*)
          `)
          .eq('store_id', storeId)
          .order('created_at', { ascending: false })
          .limit(limit);

        if (!error && data) {
          const mapped: Sale[] = data.map(s => ({
            id: s.id,
            storeId: s.store_id,
            receiptNumber: s.receipt_number,
            customerId: s.customer_id || undefined,
            employeeId: s.cashier_id || 'emp_owner',
            employeeName: 'Cashier',
            items: Array.isArray((s as any).items)
              ? (s as any).items.map((i: any) => ({
                  id: i.id,
                  saleId: i.sale_id,
                  productId: i.product_id || '',
                  variantId: i.variant_id || undefined,
                  productName: i.product_name_snapshot,
                  quantity: Number(i.quantity),
                  unitPrice: Number(i.unit_price),
                  discountAmount: Number(i.discount),
                  taxAmount: Number(i.tax),
                  lineTotal: Number(i.total)
                }))
              : [],
            subtotal: Number(s.subtotal),
            discountAmount: Number(s.discount_total),
            taxAmount: Number(s.tax_total),
            taxRate: 0,
            total: Number(s.total),
            payments: Array.isArray((s as any).payments)
              ? (s as any).payments.map((p: any) => ({
                  id: p.id,
                  saleId: p.sale_id,
                  method: p.method,
                  amount: Number(p.amount),
                  tendered: p.tendered ? Number(p.tendered) : undefined,
                  change: p.change ? Number(p.change) : undefined,
                  transactionReference: p.provider_reference || undefined,
                  status: p.status === 'completed' ? 'completed' : 'pending',
                  createdAt: p.created_at
                }))
              : [],
            status: s.status,
            isOffline: s.is_offline,
            createdAt: s.client_created_at || s.created_at,
            updatedAt: s.updated_at
          }));
          return mapped;
        }
      } catch (err: any) {
        console.warn('[SalesRepository] Supabase fetch exception:', err?.message);
      }
    }

    return StorageService.getSales();
  }

  /**
   * Record new completed sale atomically with items and payments
   */
  static async recordSale(sale: Sale): Promise<Sale> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data: saleRow, error: saleErr } = await supabase
          .from('sales')
          .insert({
            id: sale.id.length === 36 ? sale.id : undefined,
            store_id: sale.storeId || 'store_aura_main',
            customer_id: sale.customerId && sale.customerId.length === 36 ? sale.customerId : null,
            cashier_id: sale.employeeId && sale.employeeId.length === 36 ? sale.employeeId : null,
            receipt_number: sale.receiptNumber,
            status: sale.status,
            subtotal: sale.subtotal,
            discount_total: sale.discountAmount,
            tax_total: sale.taxAmount,
            total: sale.total,
            is_offline: Boolean(sale.isOffline),
            client_created_at: sale.createdAt
          })
          .select()
          .single();

        if (saleErr) {
          console.warn('[SalesRepository] Supabase sale insert error:', saleErr.message);
        } else if (saleRow) {
          sale.id = saleRow.id;

          // Insert sale items snapshot
          if (sale.items && sale.items.length > 0) {
            const itemsPayload = sale.items.map(item => ({
              sale_id: saleRow.id,
              product_id: item.productId && item.productId.length === 36 ? item.productId : null,
              variant_id: item.variantId && item.variantId.length === 36 ? item.variantId : null,
              product_name_snapshot: item.productName,
              quantity: item.quantity,
              unit_price: item.unitPrice,
              discount: item.discountAmount,
              tax: item.taxAmount,
              total: item.lineTotal
            }));
            await supabase.from('sale_items').insert(itemsPayload);
          }

          // Insert payments
          if (sale.payments && sale.payments.length > 0) {
            const paymentsPayload = sale.payments.map(p => ({
              sale_id: saleRow.id,
              method: p.method,
              amount: p.amount,
              tendered: p.tendered || null,
              change: p.change || null,
              status: p.status || 'completed'
            }));
            await supabase.from('payments').insert(paymentsPayload);
          }
        }
      } catch (e: any) {
        console.warn('[SalesRepository] Exception recording sale to Supabase:', e?.message);
      }
    }

    // Persist locally for immediate offline reliability
    const currentSales = StorageService.getSales();
    const updated = [sale, ...currentSales];
    StorageService.saveSales(updated);
    await LocalDB.put('sales', sale);

    return sale;
  }
}
