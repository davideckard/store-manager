import NextAuth from 'next-auth'
import { authConfig } from '@/auth.config'
import { NextResponse } from 'next/server'

const { auth } = NextAuth(authConfig)

export default auth((req) => {
  const isLoggedIn = !!req.auth
  const isLoginPage = req.nextUrl.pathname === '/login'

  if (!isLoggedIn && !isLoginPage) {
    return NextResponse.redirect(new URL('/login', req.url))
  }
})

export const config = {
  // Only protect pages — API routes are handled by requireAuth in each handler
  matcher: ['/((?!api/|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$).*)'],
}
