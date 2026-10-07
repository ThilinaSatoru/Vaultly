import { createContext } from "react";

/** Portalled editors follow their management tab without losing their drafts. */
export const ManagementPanelContext = createContext<{ visible: boolean } | null>(null);
