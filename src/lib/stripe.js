import Stripe from "stripe";

// Stesso pattern usato per Resend/Anthropic: il client è null finché la
// chiave non è configurata, e ogni chiamante deve gestire esplicitamente
// quel caso (mai un errore criptico a metà del codice).
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

export function stripeConfigurato() {
  return Boolean(stripe);
}
