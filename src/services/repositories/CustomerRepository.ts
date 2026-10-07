import { supabase, isSupabaseConfigured } from '../supabase/supabaseClient.ts';
import { Customer } from '../../types/pos.ts';
import { StorageService } from '../storageService.ts';
import { LocalDB } from '../db/localDatabase.ts';

export class CustomerRepository {
  /**
   * Fetch all active customers
   */
  static async getAll(storeId: string = 'store_aura_main'): Promise<Customer[]> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('customers')
          .select('*')
          .eq('store_id', storeId)
          .eq('is_active', true)
          .order('name');

        if (error) {
          console.warn('[CustomerRepository] Supabase fetch error, fallback to local storage:', error.message);
        } else if (data) {
          return data.map(c => {
            const parts = c.name.split(' ');
            const firstName = parts[0] || '';
            const lastName = parts.slice(1).join(' ') || '';
            return {
              id: c.id,
              storeId: c.store_id,
              firstName,
              lastName,
              phone: c.phone || '',
              email: c.email || '',
              address: c.address || '',
              notes: c.notes || '',
              loyaltyPoints: c.loyalty_points,
              lifetimePoints: c.lifetime_points,
              totalSpent: Number(c.total_spent),
              totalOrders: c.total_orders,
              createdAt: c.created_at,
              updatedAt: c.updated_at
            };
          });
        }
      } catch (err: any) {
        console.warn('[CustomerRepository] Supabase exception, using local store:', err?.message);
      }
    }

    return StorageService.getCustomers();
  }

  /**
   * Create or save customer
   */
  static async save(customer: Customer): Promise<Customer> {
    const fullName = `${customer.firstName} ${customer.lastName}`.trim();

    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('customers')
          .upsert({
            id: customer.id.length === 36 ? customer.id : undefined,
            store_id: customer.storeId || 'store_aura_main',
            name: fullName,
            phone: customer.phone || null,
            email: customer.email || null,
            address: customer.address || null,
            notes: customer.notes || null,
            loyalty_points: customer.loyaltyPoints || 0,
            lifetime_points: customer.lifetimePoints || 0,
            total_spent: customer.totalSpent || 0,
            total_orders: customer.totalOrders || 0,
            is_active: true
          })
          .select()
          .single();

        if (!error && data) {
          customer.id = data.id;
        }
      } catch (e: any) {
        console.warn('[CustomerRepository] Exception on save:', e?.message);
      }
    }

    const current = StorageService.getCustomers();
    const idx = current.findIndex(c => c.id === customer.id);
    if (idx !== -1) {
      current[idx] = { ...customer, updatedAt: new Date().toISOString() };
    } else {
      current.unshift(customer);
    }
    StorageService.saveCustomers(current);
    await LocalDB.put('customers', customer);

    return customer;
  }
}
