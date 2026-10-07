import { supabase, isSupabaseConfigured } from '../supabase/supabaseClient.ts';
import { Product, ProductVariant } from '../../types/pos.ts';
import { StorageService } from '../storageService.ts';
import { LocalDB } from '../db/localDatabase.ts';

export class ProductRepository {
  /**
   * Fetch all active products for a store
   */
  static async getAll(storeId: string = 'store_aura_main'): Promise<Product[]> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('products')
          .select(`
            *,
            variants:product_variants(*)
          `)
          .eq('store_id', storeId)
          .eq('is_active', true)
          .order('name');

        if (error) {
          console.warn('[ProductRepository] Supabase fetch error, falling back to local storage:', error.message);
        } else if (data) {
          const mapped: Product[] = data.map(p => ({
            id: p.id,
            storeId: p.store_id,
            categoryId: p.category_id || '',
            name: p.name,
            sku: p.sku || '',
            barcode: p.barcode || '',
            description: p.description || '',
            price: Number(p.price),
            cost: Number(p.cost),
            unit: p.unit || 'item',
            trackInventory: p.track_inventory,
            stock: Number(p.stock_minimum), // mapped or aggregated with inventory
            lowStockThreshold: Number(p.stock_minimum),
            active: p.is_active,
            isFavorite: p.is_favorite,
            imageUrl: p.image_url || undefined,
            variants: Array.isArray((p as any).variants)
              ? (p as any).variants.map((v: any) => ({
                  id: v.id,
                  productId: v.product_id,
                  name: v.name,
                  sku: v.sku || '',
                  barcode: v.barcode || '',
                  price: Number(v.price),
                  cost: Number(v.cost),
                  attributes: v.attributes || {},
                  active: v.is_active
                }))
              : [],
            createdAt: p.created_at,
            updatedAt: p.updated_at
          }));
          return mapped;
        }
      } catch (err: any) {
        console.warn('[ProductRepository] Supabase exception, using local store:', err?.message);
      }
    }

    return StorageService.getProducts();
  }

  /**
   * Get single product by ID
   */
  static async getById(id: string): Promise<Product | null> {
    const products = await this.getAll();
    return products.find(p => p.id === id) || null;
  }

  /**
   * Insert new product
   */
  static async create(product: Product): Promise<Product> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('products')
          .insert({
            id: product.id.length === 36 ? product.id : undefined,
            store_id: product.storeId || 'store_aura_main',
            category_id: product.categoryId || null,
            name: product.name,
            sku: product.sku || null,
            barcode: product.barcode || null,
            description: product.description || null,
            price: product.price,
            cost: product.cost,
            unit: product.unit || 'item',
            track_inventory: product.trackInventory,
            stock_minimum: product.lowStockThreshold || 0,
            is_favorite: Boolean(product.isFavorite),
            is_active: product.active !== false,
            image_url: product.imageUrl || null
          })
          .select()
          .single();

        if (error) {
          console.warn('[ProductRepository] Supabase insert error, persisting locally:', error.message);
        } else if (data) {
          product.id = data.id;
        }
      } catch (e: any) {
        console.warn('[ProductRepository] Exception on create:', e?.message);
      }
    }

    // Persist locally for immediate offline responsiveness
    const current = StorageService.getProducts();
    const updated = [product, ...current.filter(p => p.id !== product.id)];
    StorageService.saveProducts(updated);
    await LocalDB.put('products', product);

    return product;
  }

  /**
   * Update existing product
   */
  static async update(id: string, partial: Partial<Product>): Promise<Product | null> {
    if (isSupabaseConfigured && supabase) {
      try {
        const payload: Record<string, any> = { updated_at: new Date().toISOString() };
        if (partial.name !== undefined) payload.name = partial.name;
        if (partial.price !== undefined) payload.price = partial.price;
        if (partial.cost !== undefined) payload.cost = partial.cost;
        if (partial.categoryId !== undefined) payload.category_id = partial.categoryId || null;
        if (partial.sku !== undefined) payload.sku = partial.sku || null;
        if (partial.barcode !== undefined) payload.barcode = partial.barcode || null;
        if (partial.description !== undefined) payload.description = partial.description || null;
        if (partial.unit !== undefined) payload.unit = partial.unit;
        if (partial.trackInventory !== undefined) payload.track_inventory = partial.trackInventory;
        if (partial.lowStockThreshold !== undefined) payload.stock_minimum = partial.lowStockThreshold;
        if (partial.isFavorite !== undefined) payload.is_favorite = partial.isFavorite;
        if (partial.active !== undefined) payload.is_active = partial.active;
        if (partial.imageUrl !== undefined) payload.image_url = partial.imageUrl || null;

        await supabase.from('products').update(payload).eq('id', id);
      } catch (e: any) {
        console.warn('[ProductRepository] Exception on update:', e?.message);
      }
    }

    const current = StorageService.getProducts();
    const idx = current.findIndex(p => p.id === id);
    if (idx === -1) return null;

    const merged: Product = {
      ...current[idx],
      ...partial,
      updatedAt: new Date().toISOString()
    };
    current[idx] = merged;
    StorageService.saveProducts(current);
    await LocalDB.put('products', merged);

    return merged;
  }

  /**
   * Soft-delete product
   */
  static async delete(id: string): Promise<boolean> {
    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('products').update({ is_active: false }).eq('id', id);
      } catch (e: any) {
        console.warn('[ProductRepository] Exception on soft-delete:', e?.message);
      }
    }

    const current = StorageService.getProducts();
    const filtered = current.filter(p => p.id !== id);
    StorageService.saveProducts(filtered);
    await LocalDB.delete('products', id);
    return true;
  }
}
