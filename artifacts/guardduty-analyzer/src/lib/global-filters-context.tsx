import { createContext, useContext, useState, type ReactNode } from "react";

export type Timeframe = "1d" | "7d" | "30d" | "90d";

export interface GlobalFilters {
  accountId: string;
  timeframe: Timeframe;
}

interface GlobalFiltersContextValue {
  filters: GlobalFilters;
  setAccountId: (id: string) => void;
  setTimeframe: (t: Timeframe) => void;
}

const GlobalFiltersContext = createContext<GlobalFiltersContextValue | null>(null);

function loadFilters(): GlobalFilters {
  try {
    const raw = localStorage.getItem("guardai-global-filters");
    if (raw) return JSON.parse(raw) as GlobalFilters;
  } catch {}
  return { accountId: "all", timeframe: "7d" };
}

export function GlobalFiltersProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<GlobalFilters>(loadFilters);

  function update(next: GlobalFilters) {
    setFilters(next);
    try { localStorage.setItem("guardai-global-filters", JSON.stringify(next)); } catch {}
  }

  return (
    <GlobalFiltersContext.Provider value={{
      filters,
      setAccountId: id => update({ ...filters, accountId: id }),
      setTimeframe: t  => update({ ...filters, timeframe: t }),
    }}>
      {children}
    </GlobalFiltersContext.Provider>
  );
}

export function useGlobalFilters() {
  const ctx = useContext(GlobalFiltersContext);
  if (!ctx) throw new Error("useGlobalFilters must be used within GlobalFiltersProvider");
  return ctx;
}
