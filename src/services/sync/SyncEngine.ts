            imageUrl: p.image_url,
            createdAt: p.created_at,
            updatedAt: p.updated_at
          });
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('products', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadTaxes(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
const data = await this.pullFromCloud('taxes', storeId);
      const error = null;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const t of data) {
          await LocalDB.put('taxes', t);
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('taxes', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadCustomers(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
const data = await this.pullFromCloud('customers', storeId);
      const error = null;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const c of data) {
          await LocalDB.put('customers', {
            id: c.id,
            storeId: c.store_id,
            name: c.name,
            phone: c.phone || '',
            email: c.email || '',
            address: c.address || '',
            notes: c.notes || '',
            loyaltyPoints: c.loyalty_points || 0,
            totalSpent: Number(c.total_spent || 0),
            totalOrders: c.total_orders || 0,
            active: c.is_active,
            syncStatus: 'SYNCED',
            createdAt: c.created_at,
            updatedAt: c.updated_at
          });
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('customers', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadPrinters(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
const data = await this.pullFromCloud('printers', storeId);
      const error = null;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const pr of data) {
          await LocalDB.put('printers', pr);
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('printers', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadStoreSettings(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
      const { data, error } = await supabase.from('stores').select('*').eq('id', storeId).maybeSingle();
      if (!error && data) {
        await LocalDB.put('stores', data);
        return 1;
      }
    } catch (_) {}
    return 0;
  }

  private async downloadUserProfiles(storeId: string): Promise<number> {
    if (!supabase) return 0;
    try {
const data = await this.pullFromCloud('user_profiles', storeId);
      const error = null;
      if (!error && Array.isArray(data) && data.length > 0) {
        for (const u of data) {
          await LocalDB.put('user_profiles', u);
        }
        const latest = data[data.length - 1].updated_at;
        if (latest) await this.saveCursor('user_profiles', storeId, latest);
        return data.length;
      }
    } catch (_) {}
    return 0;
  }
}

export const SyncEngine = new SyncEngineClass();
// Auto-start SyncEngine in browser / WebView runtime
if (typeof window !== 'undefined') {
  SyncEngine.start();
}
