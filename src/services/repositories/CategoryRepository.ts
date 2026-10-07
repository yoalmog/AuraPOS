import { supabase, isSupabaseConfigured } from '../supabase/supabaseClient.ts';
import { Category } from '../../types/pos.ts';
import { StorageService } from '../storageService.ts';
import { LocalDB } from '../db/localDatabase.ts';

export class CategoryRepository {
  /**
   * Fetch all active categories for a store ordered by sort_order
   */
  static async getAll(storeId: string = 'store_aura_main'): Promise<Category[]> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('categories')
          .select(`
            *,
            translations:category_translations(*)
          `)
          .eq('store_id', storeId)
          .eq('is_active', true)
          .order('sort_order', { ascending: true });

        if (error) {
          console.warn('[CategoryRepository] Supabase fetch error, fallback to local storage:', error.message);
        } else if (data) {
          const mapped: Category[] = data.map(c => {
            const translationsMap: Record<string, { name: string; description?: string }> = {};
            if (Array.isArray((c as any).translations)) {
              (c as any).translations.forEach((t: any) => {
                translationsMap[t.locale] = {
                  name: t.name,
                  description: t.description || undefined
                };
              });
            }

            return {
              id: c.id,
              storeId: c.store_id,
              name: (translationsMap[c.default_locale]?.name) || 'Category',
              description: translationsMap[c.default_locale]?.description,
              iconName: c.icon,
              imageUrl: c.image_url || undefined,
              color: c.color,
              sortOrder: c.sort_order,
              active: c.is_active,
              defaultLocale: c.default_locale,
              parentId: c.parent_id || undefined,
              printerId: c.printer_id || undefined,
              autoPrintKitchen: c.auto_print_kitchen,
              translations: translationsMap,
              createdAt: c.created_at,
              updatedAt: c.updated_at
            };
          });
          return mapped;
        }
      } catch (err: any) {
        console.warn('[CategoryRepository] Supabase exception, using local store:', err?.message);
      }
    }

    return StorageService.getCategories();
  }

  /**
   * Insert new category with optional multi-language translations
   */
  static async create(category: Category): Promise<Category> {
    if (isSupabaseConfigured && supabase) {
      try {
        const { data, error } = await supabase
          .from('categories')
          .insert({
            id: category.id.length === 36 ? category.id : undefined,
            store_id: category.storeId || 'store_aura_main',
            default_locale: category.defaultLocale || 'en',
            icon: category.iconName || 'Utensils',
            image_url: category.imageUrl || null,
            color: category.color || '#2563EB',
            sort_order: category.sortOrder || 0,
            parent_id: category.parentId || null,
            printer_id: category.printerId || null,
            auto_print_kitchen: category.autoPrintKitchen !== false,
            is_active: category.active !== false
          })
          .select()
          .single();

        if (error) {
          console.warn('[CategoryRepository] Supabase insert error:', error.message);
        } else if (data) {
          category.id = data.id;

          // Insert translation for default locale
          const name = category.name;
          const desc = category.description || null;
          await supabase.from('category_translations').upsert({
            category_id: data.id,
            locale: category.defaultLocale || 'en',
            name: name,
            description: desc
          });
        }
      } catch (e: any) {
        console.warn('[CategoryRepository] Exception on create:', e?.message);
      }
    }

    const current = StorageService.getCategories();
    const updated = [...current.filter(c => c.id !== category.id), category];
    StorageService.saveCategories(updated);
    await LocalDB.put('categories', category);

    return category;
  }

  /**
   * Update category
   */
  static async update(id: string, partial: Partial<Category>): Promise<Category | null> {
    if (isSupabaseConfigured && supabase) {
      try {
        const payload: Record<string, any> = { updated_at: new Date().toISOString() };
        if (partial.iconName !== undefined) payload.icon = partial.iconName;
        if (partial.imageUrl !== undefined) payload.image_url = partial.imageUrl || null;
        if (partial.color !== undefined) payload.color = partial.color;
        if (partial.sortOrder !== undefined) payload.sort_order = partial.sortOrder;
        if (partial.parentId !== undefined) payload.parent_id = partial.parentId || null;
        if (partial.printerId !== undefined) payload.printer_id = partial.printerId || null;
        if (partial.autoPrintKitchen !== undefined) payload.auto_print_kitchen = partial.autoPrintKitchen;
        if (partial.active !== undefined) payload.is_active = partial.active;

        await supabase.from('categories').update(payload).eq('id', id);

        if (partial.name) {
          await supabase.from('category_translations').upsert({
            category_id: id,
            locale: partial.defaultLocale || 'en',
            name: partial.name,
            description: partial.description || null
          });
        }
      } catch (e: any) {
        console.warn('[CategoryRepository] Exception on update:', e?.message);
      }
    }

    const current = StorageService.getCategories();
    const idx = current.findIndex(c => c.id === id);
    if (idx === -1) return null;

    const merged: Category = {
      ...current[idx],
      ...partial,
      updatedAt: new Date().toISOString()
    };
    current[idx] = merged;
    StorageService.saveCategories(current);
    await LocalDB.put('categories', merged);

    return merged;
  }

  /**
   * Delete category with product reassignment
   */
  static async delete(id: string, destinationCategoryId?: string): Promise<boolean> {
    if (destinationCategoryId) {
      // Reassign products to destination category first
      const products = StorageService.getProducts();
      const updatedProducts = products.map(p =>
        p.categoryId === id ? { ...p, categoryId: destinationCategoryId } : p
      );
      StorageService.saveProducts(updatedProducts);

      if (isSupabaseConfigured && supabase) {
        try {
          await supabase.from('products').update({ category_id: destinationCategoryId }).eq('category_id', id);
        } catch (_) {}
      }
    }

    if (isSupabaseConfigured && supabase) {
      try {
        await supabase.from('categories').update({ is_active: false }).eq('id', id);
      } catch (e: any) {
        console.warn('[CategoryRepository] Exception on soft-delete:', e?.message);
      }
    }

    const current = StorageService.getCategories();
    const filtered = current.filter(c => c.id !== id);
    StorageService.saveCategories(filtered);
    await LocalDB.delete('categories', id);
    return true;
  }
}
