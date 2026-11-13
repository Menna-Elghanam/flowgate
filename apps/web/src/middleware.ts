import { NextResponse, type NextRequest } from 'next/server';

/**
 * Cheap first check: no session cookie means no point rendering the app, go to login.
 * The real check is the API's, which rejects expired or forged cookies with 401.
 */
export function middleware(request: NextRequest) {
  if (!request.cookies.has('fg_session')) {
    const login = new URL('/login', request.url);
    login.searchParams.set('next', request.nextUrl.pathname);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/o/:path*'] };
