// Server-only Supabase clients using the service_role / secret key.
// Never import this from a client component, and never expose the key.
import "server-only";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function make(headers?: Record<string, string>) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_URL) is not set. " +
      "Add it to your env (server-only — do NOT prefix with NEXT_PUBLIC_)."
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: headers ? { headers } : undefined,
  });
}

export function supabaseAdmin() {
  return make();
}

/**
 * Service-role client that acts on behalf of a user: writes made through it are
 * attributed to `userId` in the audit trail and payment log (see
 * public.current_actor() in supabase/024). Permission checks are the caller's job.
 */
export function supabaseAs(userId: string) {
  return make({ "x-actor-id": userId });
}
