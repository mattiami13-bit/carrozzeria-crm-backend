import { createClient } from "@supabase/supabase-js";

// Client "service role": usato SOLO lato server per caricare/cancellare
// foto su Supabase Storage. La service role key bypassa le policy di
// sicurezza (RLS) quindi non va MAI esposta al frontend o al browser:
// resta solo qui, nelle variabili d'ambiente del backend.
export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const PHOTOS_BUCKET = "vehicle-photos";
