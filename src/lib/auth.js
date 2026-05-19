import GoogleProvider from 'next-auth/providers/google';
import { getUserByEmail, isRegisteredUser } from './users';

export const authOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],

  session: {
    strategy: 'jwt',
    maxAge: 8 * 60 * 60, // 8 horas
  },

  callbacks: {
    /**
     * Solo permite el login si el email es @gocab.io
     */
    async signIn({ account, profile }) {
      if (account?.provider === 'google') {
        // Solo permite usuarios explícitamente registrados en la lista maestra
        return isRegisteredUser(profile?.email) ?? false;
      }
      return false;
    },

    /**
     * Agrega role e isManager al JWT en el primer login.
     */
    async jwt({ token, profile }) {
      if (profile?.email) {
        const user = getUserByEmail(profile.email);
        token.role = user?.role ?? 'Colaborador';
        token.isManager = user?.isManager ?? false;
        token.gocabName = user?.name ?? token.name;
      }
      return token;
    },

    /**
     * Expone role e isManager en la sesión del cliente.
     */
    async session({ session, token }) {
      session.user.role = token.role;
      session.user.isManager = token.isManager;
      session.user.gocabName = token.gocabName;
      return session;
    },
  },

  pages: {
    signIn: '/',
    error: '/',
  },
};
