import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // BUG FIX: persistSession alone does nothing in React Native — Supabase's default storage
    // falls back to window.localStorage, which doesn't exist here (that's a browser API). Without
    // an explicit storage adapter, the session only ever lived in JS memory for the life of the
    // app process, so force-quitting/killing the app (not just backgrounding it) wiped it
    // entirely, and re-opening the app looked exactly like being logged out. AsyncStorage
    // persists to real on-device storage, which is what persistSession actually needs to work.
    storage: AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
