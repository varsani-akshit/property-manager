import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function middleware(req: NextRequest) {
  let res = NextResponse.next({ request: req });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: (toSet: { name: string; value: string; options?: any }[]) => {
          for (const { name, value } of toSet) req.cookies.set(name, value);
          res = NextResponse.next({ request: req });
          for (const { name, value, options } of toSet) res.cookies.set(name, value, options);
        },
      },
    }
  );

  // Cheap session check via getSession (reads cookie, no network round-trip
  // to Supabase auth server). Page-level code re-verifies with getUser() when needed.
  const { data: { session } } = await supabase.auth.getSession();
  const path = req.nextUrl.pathname;
  // /auth/* handles the email-link redirect + set-password flow; let it through.
  const isPublic = path === "/login" || path.startsWith("/auth/");
  // set-password specifically needs a session, so don't block it like login.
  const isLoginOnly = path === "/login";

  if (!session && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }
  if (session && isLoginOnly) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }
  return res;
}

export const config = {
  // Skip middleware for static assets, images, favicons, and API routes that handle their own auth.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|woff|woff2|ttf)$).*)",
  ],
};
