-- Segnalato dal Security Advisor di Supabase (RLS Disabled in Public):
-- stripe_webhook_events era rimasta esclusa dalla Fase 1 RLS (migrazione
-- 20260915170000) perché è una tabella globale senza tenantId, quindi
-- "non serve isolamento tenant" — ma questo non significa che vada
-- lasciata priva di RLS: qualunque tabella nello schema public è
-- raggiungibile dall'API REST automatica di Supabase (PostgREST) se RLS
-- non la protegge. Nessuna policy = accesso negato di default a
-- chiunque non sia il proprietario della tabella (il ruolo con cui
-- l'app si connette).
ALTER TABLE "stripe_webhook_events" ENABLE ROW LEVEL SECURITY;
