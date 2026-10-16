import { connectMediaOutput } from "./audio-output";
import { useEffect, useRef, type RefObject } from "react";

// Alternate audio stays tied to the original video's clock, so changing tracks
// preserves both its picture and the current seek position.
export function VideoAudioTrack({ src, videoRef, wantsPlayback, volume, muted, rate, onError, onLoading }: {
  src: string; videoRef: RefObject<HTMLVideoElement | null>; wantsPlayback: RefObject<boolean>; volume: number; muted: boolean; rate: number;
  onError: () => void; onLoading: (loading: boolean) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  useEffect(() => { if (audioRef.current) return connectMediaOutput(audioRef.current); }, []);
  useEffect(() => {
    const audio = audioRef.current, video = videoRef.current;
    if (!audio || !video) return;
    wantsPlayback.current = wantsPlayback.current || !video.paused;
    let preparing = true;
    let failed = false;
    onLoading(true);
    video.pause();
    const playAudio = () => {
      void audio.play().catch((failure: unknown) => {
        const name = failure && typeof failure === "object" && "name" in failure ? String(failure.name) : "";
        if (name === "AbortError") return;
        if (name === "NotAllowedError") { wantsPlayback.current = false; video.pause(); return; }
        onError();
      });
    };
    const align = () => {
      if (audio.readyState >= 1 && Math.abs(audio.currentTime - video.currentTime) > .1) {
        audio.currentTime = video.currentTime;
        return true;
      }
      if (!preparing && !failed && !video.paused && audio.paused) playAudio();
      return false;
    };
    const play = () => {
      if (failed) return;
      if (preparing) { wantsPlayback.current = true; video.pause(); return; }
      align(); playAudio();
    };
    const pause = () => audio.pause();
    const ready = () => {
      if (align() || audio.readyState < 3 || !preparing) return;
      preparing = false; onLoading(false);
      if (wantsPlayback.current) void video.play().catch(() => undefined);
    };
    const waiting = () => {
      if (!preparing && !video.paused) {
        wantsPlayback.current = true; preparing = true; onLoading(true); video.pause();
      }
    };
    const error = () => { failed = true; preparing = false; onLoading(false); onError(); if (wantsPlayback.current) void video.play().catch(() => undefined); };
    video.addEventListener("play", play);
    video.addEventListener("pause", pause);
    video.addEventListener("seeking", align);
    video.addEventListener("timeupdate", align);
    audio.addEventListener("canplay", ready);
    audio.addEventListener("seeked", ready);
    audio.addEventListener("waiting", waiting);
    audio.addEventListener("error", error);
    return () => {
      video.removeEventListener("play", play); video.removeEventListener("pause", pause);
      video.removeEventListener("seeking", align); video.removeEventListener("timeupdate", align);
      audio.removeEventListener("canplay", ready); audio.removeEventListener("seeked", ready); audio.removeEventListener("waiting", waiting); audio.removeEventListener("error", error);
      audio.pause();

    };
  }, [src, videoRef]);
  useEffect(() => { const audio = audioRef.current; if (audio) { audio.volume = volume; audio.muted = muted; audio.playbackRate = rate; } }, [volume, muted, rate]);
  return <audio ref={audioRef} src={src} preload="auto" />;
}
