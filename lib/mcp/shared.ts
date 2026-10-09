import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Permission, UserProfile } from "@/lib/permissions";

export type ToolCtx = { profile: UserProfile; sb: SupabaseClient };
export type Def<S extends z.ZodObject> = {
  name: string;
  title: string;
  summary: string;       // one line, shown in the app
  description: string;   // what the model reads
  /** Permission the key's owner needs; null = anyone with a key. */
  perm: Permission | null;
  writes?: boolean;
  input: S;
  run: (args: z.infer<S>, ctx: ToolCtx) => Promise<unknown>;
};
export const def = <S extends z.ZodObject>(d: Def<S>) => d;

export const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");
export const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
export const r2 = (n: number) => Math.round(n * 100) / 100;
export const num = (v: unknown) => (v == null ? null : Number(v));
