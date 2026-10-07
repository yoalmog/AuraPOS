import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Database } from '../../types/database.types.ts';

// Extract credentials from Vite client environment
const supabaseUrl = import.meta.env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.trim() !== '' &&
  supabaseAnonKey.trim() !== '' &&
  !supabaseUrl.includes('placeholder')
);

if (!isSupabaseConfigured) {
  console.info(
    '[AuraPOS Supabase] Supabase credentials (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY) are not configured yet. The client will operate in local persistence mode until credentials are provided.'
  );
}

// Single centralized Supabase client instance
export const supabase: SupabaseClient<Database> | null = isSupabaseConfigured
  ? createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'aurapos_supabase_auth_token'
      },
      realtime: {
        params: {
          eventsPerSecond: 10
        }
      }
    })
  : null;
