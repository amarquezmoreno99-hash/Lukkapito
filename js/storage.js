// Data access layer. The only module that talks to Supabase.

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const isConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

// Implicit flow: the magic link works even if the email is opened in a
// different browser from the one that requested it.
const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { flowType: 'implicit', detectSessionInUrl: true, persistSession: true },
    })
  : null;

// Error carrying a Spanish message that can be shown to the user as-is.
export class AppError extends Error {
  constructor(userMessage, cause) {
    super(userMessage);
    this.name = 'AppError';
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

export const MESSAGES = {
  notAllowed: 'Este email no tiene acceso a la aplicación. Pide a un administrador que te dé de alta.',
  rateLimited: 'Has pedido demasiados enlaces seguidos. Espera unos minutos y vuelve a intentarlo.',
  network: 'No se ha podido conectar con el servidor. Revisa tu conexión e inténtalo de nuevo.',
  linkExpired: 'El enlace ha caducado o ya se ha usado. Pide uno nuevo.',
  generic: 'Ha ocurrido un error inesperado. Inténtalo de nuevo en unos minutos.',
};

function toAppError(error) {
  console.error(error);
  if (error?.status === 403) return new AppError(MESSAGES.notAllowed, error);
  if (error?.status === 429 || error?.code === 'over_email_send_rate_limit') {
    return new AppError(MESSAGES.rateLimited, error);
  }
  if (error?.name === 'AuthRetryableFetchError' || error instanceof TypeError) {
    return new AppError(MESSAGES.network, error);
  }
  return new AppError(MESSAGES.generic, error);
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

// The page URL without hash or query: where the magic link brings users back.
function appUrl() {
  return `${location.origin}${location.pathname}`;
}

// Resolves once the client has also processed any magic-link tokens in the URL.
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw toAppError(error);
  return data.session;
}

export async function sendMagicLink(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: appUrl() },
  });
  if (error) throw toAppError(error);
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw toAppError(error);
}

export function onSignedOut(callback) {
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') callback();
  });
}

// The signed-in user's allowlist entry ({ email, name, role }), or null if
// their email is not (or no longer) on the allowlist.
export async function getCurrentMember(session) {
  const email = session.user.email.toLowerCase();
  const { data, error } = await supabase
    .from('allowed_users')
    .select('email, name, role')
    .eq('email', email)
    .maybeSingle();
  if (error) throw toAppError(error);
  return data;
}
