import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL = "https://fgyqsxniynkmvxwyvcyt.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZneXFzeG5peW5rbXZ4d3l2Y3l0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQzMzM1ODEsImV4cCI6MjA4OTkwOTU4MX0.mFE8MUKjkrZrF67cg_5rT-o6uwHJX2YnBb9f2uq08jg";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
