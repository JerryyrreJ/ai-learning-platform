import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { requiresMfa } from "@/lib/auth/policy";

/** Refresh SSR cookies and enforce MFA before rendered workspaces. APIs also
 * enforce MFA in requireAccount; direct Data API calls use restrictive RLS. */
export async function middleware(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const protectedPath =
    /^\/(dashboard|teach|my-courses|studio|account)(\/|$)/.test(
      request.nextUrl.pathname,
    );
  if (!url || !key) {
    return protectedPath
      ? NextResponse.redirect(
          new URL(
            `/login?next=${encodeURIComponent(request.nextUrl.pathname + request.nextUrl.search)}`,
            request.url,
          ),
        )
      : NextResponse.next();
  }
  let response = NextResponse.next({ request });
  const db = createServerClient(url, key, {
    auth: { experimental: { passkey: true } },
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(values) {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  const {
    data: { user },
  } = await db.auth.getUser();
  const path = request.nextUrl.pathname;
  if (
    path.startsWith("/api/") ||
    path === "/login" ||
    path === "/signup" ||
    path === "/forgot-password" ||
    path === "/auth/callback" ||
    path.startsWith("/auth/confirm")
  )
    return response;
  const next = `${path}${request.nextUrl.search}`;
  function redirect(destination: string) {
    const result = NextResponse.redirect(new URL(destination, request.url));
    response.cookies.getAll().forEach((cookie) => result.cookies.set(cookie));
    return result;
  }
  if (!user) {
    if (protectedPath || path.startsWith("/auth/"))
      return redirect(`/login?next=${encodeURIComponent(next)}`);
    return response;
  }
  const { data: claims, error } = await db.auth.getClaims();
  if (error || !claims)
    return redirect(`/login?next=${encodeURIComponent(next)}`);
  if (requiresMfa(user, claims.claims.aal) && path !== "/auth/mfa")
    return redirect(`/auth/mfa?next=${encodeURIComponent(next)}`);
  if (path.startsWith("/auth/") || path === "/account") return response;
  const { data: state, error: stateError } = await db.rpc(
    "account_security_state",
  );
  if (stateError)
    return redirect(`/auth/setup?next=${encodeURIComponent(next)}`);
  if (state?.credential_ready !== true)
    return redirect(`/auth/setup?next=${encodeURIComponent(next)}`);
  return response;
}
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
