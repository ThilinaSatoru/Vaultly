import type { ComponentProps } from "react";
import { useUiState } from "./ui-state";

export function PersistentDetails({ stateKey, open: initialOpen = false, ...props }: ComponentProps<"details"> & { stateKey: string }) {
  const [open, setOpen] = useUiState(`vaultly.ui.details.${stateKey}`, initialOpen);
  return <details {...props} open={open} onToggle={(event) => setOpen(event.currentTarget.open)} />;
}
