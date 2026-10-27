import { createContext, useContext } from "react";
import type { Session } from "./api";

export interface AuthContextValue {
  session: Session;
  onSignOut: () => void;
  signingOut: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthContext.Provider");
  return value;
}
