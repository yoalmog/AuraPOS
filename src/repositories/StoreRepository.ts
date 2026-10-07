import { BaseRepository } from './BaseRepository.ts';
import { Database } from '../types/database.types.ts';
import { StoreSettings } from '../types/pos.ts';
import { StorageService } from '../services/storageService.ts';

type StoreRow = Database['public']['Tables']['stores']['Row'];
type StoreInsert = Database['public']['Tables']['stores']['Insert'];
type StoreUpdate = Database['public']['Tables']['stores']['Update'];

export class StoreRepository extends BaseRepository<'stores', StoreRow, StoreInsert, StoreUpdate> {
  constructor() {
    super('stores');
  }

  /**
   * Get active store by store ID with local fallback
   */
  async getStoreById(storeId: string = 'store_aura_main'): Promise<StoreRow | null> {
    const store = await this.findById(storeId);
    if (store) return store;

    // Local fallback for offline / initial startup
    const local = StorageService.getSettings();
    return {
      id: local.id || storeId,
      name: local.name || 'AuraPOS Store',
      legal_name: null,
      address: {
        address: local.address || '',
        city: local.city || '',
        state: local.state || '',
        zip: local.zip || '',
        country: local.country || ''
      },
      phone: local.phone || null,
      email: local.email || null,
      currency: local.currency || '$',
      timezone: local.timezone || 'UTC',
      default_locale: local.language || 'en',
      tax_number: local.taxId || null,
      logo_url: local.logoUrl || null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
  }

  /**
   * Update store settings & synchronize with local storage
   */
  async updateStoreSettings(storeId: string, settings: Partial<StoreSettings>): Promise<StoreSettings> {
    const updates: StoreUpdate = {};

    if (settings.name !== undefined) updates.name = settings.name;
    if (settings.currency !== undefined) updates.currency = settings.currency;
    if (settings.timezone !== undefined) updates.timezone = settings.timezone;
    if (settings.language !== undefined) updates.default_locale = settings.language;
    if (settings.taxId !== undefined) updates.tax_number = settings.taxId || null;
    if (settings.logoUrl !== undefined) updates.logo_url = settings.logoUrl || null;
    if (settings.phone !== undefined) updates.phone = settings.phone || null;
    if (settings.email !== undefined) updates.email = settings.email || null;

    if (this.isConfigured()) {
      try {
        await this.update(storeId, updates);
      } catch (e: any) {
        console.warn('[StoreRepository] Could not update remote store:', e?.message);
      }
    }

    // Always update local storage for immediate UI persistence
    const current = StorageService.getSettings();
    const merged: StoreSettings = { ...current, ...settings };
    StorageService.saveSettings(merged);
    return merged;
  }
}

export const storeRepository = new StoreRepository();
