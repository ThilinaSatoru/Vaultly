import { createContext } from "react";
import type { MediaType } from "./media";

export type AttributeManagerKind = "tags" | "categories" | "people";
export const AttributeManagerContext = createContext<{
  open: (kind: AttributeManagerKind, mediaType?: MediaType) => void;
  isOpen: boolean;
} | null>(null);
