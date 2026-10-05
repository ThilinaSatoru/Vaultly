import { useEffect, useState } from "react";
import { api } from "./media";

interface PlaybackStatus {
  state: "idle" | "queued" | "preparing" | "ready" | "failed";
  percent: number;
  message?: string;
}
export function needsCompatiblePlayback(extension?: string) {
  return Boolean(extension && !["mp4", "m4v", "webm"].includes(extension.toLowerCase()));
}

export function useVideoPlayback(src: string, itemId?: number, extension?: string) {
  const [compatible, setCompatible] = useState(Boolean(itemId && needsCompatiblePlayback(extension)));
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<PlaybackStatus>({ state: "idle", percent: 0 });
  useEffect(() => {
    if (!compatible || !itemId) return;
    const controller = new AbortController();
    const session = crypto.randomUUID();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let preparing = true;
    setStatus({ state: "queued", percent: 0 });
    const poll = async (start: boolean) => {
      try {
        const next = await api<PlaybackStatus>(`/api/items/${itemId}/playback`, {
          signal: controller.signal,
          ...(start ? { method: "POST", body: JSON.stringify({ retry: attempt > 0, session }) } : {}),
        });
        if (controller.signal.aborted) return;
        setStatus(next);
        preparing = next.state !== "ready" && next.state !== "failed";
        if (preparing) timer = setTimeout(() => void poll(next.state === "idle"), 1000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setStatus({ state: "failed", percent: 0,
          message: error instanceof Error ? error.message : "Could not prepare this video for playback." });
      }
    };
    void poll(true);
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (preparing) void api(`/api/items/${itemId}/playback`, { method: "DELETE", body: JSON.stringify({ session }) }).catch(() => undefined);
    };
  }, [compatible, itemId, attempt]);
  return {
    src: compatible ? status.state === "ready" ? `/api/items/${itemId}/playback/file` : undefined : src,
    preparing: compatible && status.state !== "ready" && status.state !== "failed",
    queued: status.state === "queued",
    percent: status.percent,
    error: compatible && status.state === "failed" ? status.message ?? "Could not prepare this video for playback." : "",
    compatible,
    fallback: () => setCompatible(true),
    retry: () => setAttempt((value) => value + 1),
  };
}
