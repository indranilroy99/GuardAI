/**
 * Auth context — Clerk-backed thin wrapper
 * Exposes the same interface as before so all components work unchanged.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useUser, useClerk } from "@clerk/react";

export interface User {
  id: string;
  username: string;
  email: string;
  name: string;
  imageUrl?: string;
}

interface AuthContextValue {
  user: User | null;
  isLoading: boolean;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user: clerkUser, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();

  const user: User | null =
    isLoaded && isSignedIn && clerkUser
      ? {
          id: clerkUser.id,
          username:
            clerkUser.primaryEmailAddress?.emailAddress?.split("@")[0] ||
            clerkUser.firstName ||
            clerkUser.id,
          email: clerkUser.primaryEmailAddress?.emailAddress ?? "",
          name:
            `${clerkUser.firstName ?? ""} ${clerkUser.lastName ?? ""}`.trim() ||
            clerkUser.primaryEmailAddress?.emailAddress ||
            "",
          imageUrl: clerkUser.imageUrl,
        }
      : null;

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading: !isLoaded,
        logout: () => signOut(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
