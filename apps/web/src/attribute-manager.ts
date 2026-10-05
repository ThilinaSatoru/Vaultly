import { createContext } from "react";

export type AttributeManagerKind = "tags" | "categories" | "people";
export const AttributeManagerContext = createContext<{
  open: (kind: AttributeManagerKind) => void;
  isOpen: boolean;
} | null>(null);
