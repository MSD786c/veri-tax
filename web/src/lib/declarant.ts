import { useState } from "react";

const KEY = "veritax.declaredBy";

/** The name or email a supplier signs declarations with, remembered per browser for convenience. */
export function useDeclarant(): [string, (v: string) => void] {
  const [value, setValue] = useState(() => {
    try {
      return localStorage.getItem(KEY) ?? "";
    } catch {
      return "";
    }
  });
  const set = (v: string) => {
    setValue(v);
    try {
      localStorage.setItem(KEY, v);
    } catch {
      /* not remembered */
    }
  };
  return [value, set];
}
