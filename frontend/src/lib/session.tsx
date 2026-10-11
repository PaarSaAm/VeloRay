import { createContext, useContext } from "react";
import type { Session } from "./api";
export const SessionContext = createContext<Session | null>(null);
export const useSession = () => useContext(SessionContext);
export const can = (session: Session | null, permission: string) =>
  !!session?.is_superuser || !!session?.permissions?.includes(permission);
