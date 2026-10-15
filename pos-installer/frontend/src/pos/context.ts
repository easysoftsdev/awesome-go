import { createContext, useContext } from "react";
import type { Config, SyncStatus } from "../../bindings/pos-installer";

export type ViewKey = "sale" | "products" | "sales" | "reports" | "settings";

export type AppContextValue = {
  config: Config;
  sync: SyncStatus;
  refreshConfig: () => Promise<void>;
  refreshSync: () => Promise<void>;
  runSyncNow: () => Promise<void>;
  onWizardReset: () => void;
  goto: (view: ViewKey) => void;
};

export const AppCtx = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useApp must be used inside PosApp");
  return ctx;
}
