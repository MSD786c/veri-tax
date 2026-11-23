import { createContext, useContext, type ReactNode } from "react";
import type { RuleCatalog, RuleInfo } from "../api/types.ts";
import { useApi } from "./useApi.ts";

const RulesContext = createContext<RuleCatalog | undefined>(undefined);

/** Loads GET /meta/rules once so any page can label a rule ID ("NR-02" -> "Eligible goods or services"). */
export function RulesProvider({ children }: { children: ReactNode }) {
  const { data } = useApi<RuleCatalog>("/meta/rules");
  return <RulesContext.Provider value={data}>{children}</RulesContext.Provider>;
}

export function useRules(): { version: string | undefined; rule: (id: string) => RuleInfo | undefined; ids: string[] } {
  const catalog = useContext(RulesContext);
  return {
    version: catalog?.ruleset_version,
    rule: (id) => catalog?.rules[id],
    ids: catalog ? Object.keys(catalog.rules) : [],
  };
}
