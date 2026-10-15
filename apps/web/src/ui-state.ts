import { useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { vaultStorage } from "./vault-session";

export function readUiState<T>(key: string, fallback: T): T {
  try {
    const value: unknown = JSON.parse(vaultStorage.getItem(key) ?? "null");
    if (value === null || typeof value !== typeof fallback || Array.isArray(value) !== Array.isArray(fallback)) return fallback;
    return value as T;
  } catch { return fallback; }
}

/** Durable UI choices use the same profile store and backup path as preferences. */
export function useUiState<T>(key: string, fallback: T): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => readUiState(key, fallback));
  useEffect(() => { vaultStorage.setItem(key, JSON.stringify(value)); }, [key, value]);
  return [value, setValue];
}
