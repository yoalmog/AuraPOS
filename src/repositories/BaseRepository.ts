import { SupabaseClient } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../lib/supabase.ts';
import { Database } from '../types/database.types.ts';

export abstract class BaseRepository<
  TTableName extends keyof Database['public']['Tables'],
  TRow = Database['public']['Tables'][TTableName]['Row'],
  TInsert = Database['public']['Tables'][TTableName]['Insert'],
  TUpdate = Database['public']['Tables'][TTableName]['Update']
> {
  protected client: SupabaseClient<Database>;
  protected tableName: TTableName;

  constructor(tableName: TTableName) {
    this.tableName = tableName;
    this.client = supabase;
  }

  /**
   * Check if Supabase connection is actively configured
   */
  protected isConfigured(): boolean {
    return isSupabaseConfigured;
  }

  /**
   * Fetch record by ID
   */
  async findById(id: string): Promise<TRow | null> {
    if (!this.isConfigured()) return null;

    const { data, error } = await (this.client
      .from(this.tableName)
      .select('*')
      .eq('id', id)
      .single() as any);

    if (error) {
      console.warn(`[${String(this.tableName)}] findById error:`, error.message);
      return null;
    }
    return data as TRow;
  }

  /**
   * Fetch all records matching criteria
   */
  async findAll(filter?: Record<string, any>): Promise<TRow[]> {
    if (!this.isConfigured()) return [];

    let query = this.client.from(this.tableName).select('*') as any;

    if (filter) {
      Object.entries(filter).forEach(([key, val]) => {
        if (val !== undefined && val !== null) {
          query = query.eq(key, val);
        }
      });
    }

    const { data, error } = await query;
    if (error) {
      console.warn(`[${String(this.tableName)}] findAll error:`, error.message);
      return [];
    }
    return (data || []) as TRow[];
  }

  /**
   * Insert a new record
   */
  async create(item: TInsert): Promise<TRow | null> {
    if (!this.isConfigured()) return null;

    const { data, error } = await (this.client
      .from(this.tableName)
      .insert(item as any)
      .select()
      .single() as any);

    if (error) {
      console.error(`[${String(this.tableName)}] create error:`, error.message);
      throw new Error(error.message);
    }
    return data as TRow;
  }

  /**
   * Update record by ID
   */
  async update(id: string, updates: TUpdate): Promise<TRow | null> {
    if (!this.isConfigured()) return null;

    const { data, error } = await (this.client
      .from(this.tableName)
      .update(updates as any)
      .eq('id', id)
      .select()
      .single() as any);

    if (error) {
      console.error(`[${String(this.tableName)}] update error:`, error.message);
      throw new Error(error.message);
    }
    return data as TRow;
  }

  /**
   * Delete record by ID (or soft-delete if supported)
   */
  async delete(id: string): Promise<boolean> {
    if (!this.isConfigured()) return false;

    const { error } = await this.client
      .from(this.tableName)
      .delete()
      .eq('id', id);

    if (error) {
      console.error(`[${String(this.tableName)}] delete error:`, error.message);
      return false;
    }
    return true;
  }
}
