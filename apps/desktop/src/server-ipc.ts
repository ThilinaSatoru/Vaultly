export interface DesktopRequest { type: "desktop"; id: number; action: "pick-directory" | "reveal-path" | "open-video"; path?: string }
export interface DesktopResponse { type: "desktop-result"; id: number; value?: string | null; error?: string }
