import type { NextAuthConfig } from 'next-auth'

export const authConfig = {
  trustHost: true,
  pages: { signIn: '/login' },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user
    },
  },
  providers: [],
} satisfies NextAuthConfig
