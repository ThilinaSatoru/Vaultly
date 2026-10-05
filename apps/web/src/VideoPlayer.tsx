import { LoaderCircle, Maximize, Minimize, Pause, Play, RefreshCw, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { matchesShortcut, readNumberPreference } from "./preferences";
import { useVideoPlayback } from "./useVideoPlayback";

interface VideoPlayerProps {
  src: string;
  itemId?: number;
  fileExtension?: string;
  autoPlay: boolean;
  compact?: boolean;
  onEnded?: () => void;
  onError: (message: string) => void;
}

const readStoredVolume = () => {
  return readNumberPreference("vaultly.video.volume", 1, 0, 1);
};

const readStoredMuted = () => window.localStorage.getItem("vaultly.video.muted") === "true";
const readSeekSeconds = (large = false) => {
  const storedUnit = window.localStorage.getItem(large ? "vaultly.video.seekLargeUnit" : "vaultly.video.seekUnit");
  const unit = storedUnit === "minutes" || storedUnit === "seconds"
    ? storedUnit
    : large ? "minutes" : "seconds";
  return readNumberPreference(
    large ? "vaultly.video.seekLargeAmount" : "vaultly.video.seekAmount",
    large ? 1 : 5,
    .25,
    999,
  ) * (unit === "minutes" ? 60 : 1);
};
const seekLabel = (seconds: number) => seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds)) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function VideoPlayer({ src, itemId, fileExtension, autoPlay, compact = false, onEnded, onError }: VideoPlayerProps) {
  const playback = useVideoPlayback(src, itemId, fileExtension);
  const resumeTime = useRef(0);
  const resumePlaying = useRef(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const seekPeekTimer = useRef<number | null>(null);
  const volumeTimer = useRef<number | null>(null);
  const lastWheelChange = useRef(0);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(readStoredVolume);
  const [muted, setMuted] = useState(readStoredMuted);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [seeking, setSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [volumeFeedback, setVolumeFeedback] = useState<number | null>(null);

  const requestCompatiblePlayback = () => {
    resumeTime.current = videoRef.current?.currentTime ?? 0;
    resumePlaying.current = playing;
    videoRef.current?.pause();
    onError("");
    playback.fallback();
  };

  const showVolumeFeedback = (value: number) => {
    setVolumeFeedback(Math.round(value * 100));
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => setVolumeFeedback(null), 900);
  };

  // Sync state from the underlying <video> element
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.volume = volume;
    video.muted = muted;
    const onTimeUpdate = () => { if (!seeking) setCurrent(video.currentTime); };
    const onLoadedMeta = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const onProgress = () => {
      if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolume = () => {
      setVolume(video.volume);
      setMuted(video.muted);
      window.localStorage.setItem("vaultly.video.volume", String(video.volume));
      window.localStorage.setItem("vaultly.video.muted", String(video.muted));
    };
    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("loadedmetadata", onLoadedMeta);
    video.addEventListener("progress", onProgress);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("volumechange", onVolume);
    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("loadedmetadata", onLoadedMeta);
      video.removeEventListener("progress", onProgress);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("volumechange", onVolume);
    };
  }, [seeking]);

  useEffect(() => {
    const video = videoRef.current;
    if (playback.src && (autoPlay || resumePlaying.current) && video?.paused) void video.play().catch(() => undefined);
  }, [autoPlay, playback.src]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const scheduleHide = (isPlaying: boolean) => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => { if (isPlaying) setShowControls(false); }, 2500);
  };

  useEffect(() => {
    setShowControls(true);
    scheduleHide(playing);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      if (seekPeekTimer.current) window.clearTimeout(seekPeekTimer.current);
      if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    };
  }, [playing]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => {}); else video.pause();
  };

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.min(Math.max(0, video.currentTime + delta), (duration || video.duration || Infinity));
    video.currentTime = target;
    setCurrent(target);
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    if (seekPeekTimer.current) window.clearTimeout(seekPeekTimer.current);
    if (playing) seekPeekTimer.current = window.setTimeout(() => setShowControls(false), 1000);
  };

  const changeVolume = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.min(1, Math.max(0, Math.round((video.volume + delta) * 100) / 100));
    video.volume = next;
    if (next > 0 && video.muted) video.muted = false;
    showVolumeFeedback(next);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    showVolumeFeedback(video.muted ? 0 : video.volume);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement === container) void document.exitFullscreen().catch(() => {});
    else void container.requestFullscreen().catch(() => {});
  };

  const handleSeekInput = (value: number) => {
    setSeeking(true);
    setSeekPreview(value);
    // Update immediately so keyboard-operated range inputs seek as well as pointer drags.
    if (videoRef.current) videoRef.current.currentTime = value;
    setCurrent(value);
  };

  const commitSeek = () => {
    const video = videoRef.current;
    if (video && seekPreview !== null) {
      video.currentTime = seekPreview;
      setCurrent(seekPreview);
    }
    setSeeking(false);
    setSeekPreview(null);
    containerRef.current?.focus({ preventScroll: true });
  };

  // Keyboard shortcuts, scoped to this player while it's mounted (the viewer is a modal, so this is fine)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable], .dialog-backdrop")) return;
      const activatingControl = Boolean(target?.closest("button, a"));
      if (matchesShortcut(event, "video.playPause")) {
        if (activatingControl && (event.code === "Space" || event.code === "Enter")) return;
        event.preventDefault(); if (!event.repeat) togglePlay(); return;
      }
      if (matchesShortcut(event, "video.fullscreen")) {
        if (activatingControl && (event.code === "Space" || event.code === "Enter")) return;
        event.preventDefault(); if (!event.repeat) toggleFullscreen(); return;
      }
      if (matchesShortcut(event, "video.seekForwardLarge")) {
        event.preventDefault(); seekBy(readSeekSeconds(true)); return;
      }
      if (matchesShortcut(event, "video.seekBackLarge")) {
        event.preventDefault(); seekBy(-readSeekSeconds(true)); return;
      }
      if (matchesShortcut(event, "video.seekForward")) {
        event.preventDefault(); seekBy(readSeekSeconds()); return;
      }
      if (matchesShortcut(event, "video.seekBack")) {
        event.preventDefault(); seekBy(-readSeekSeconds()); return;
      }
      if (matchesShortcut(event, "video.volumeUp")) {
        event.preventDefault(); changeVolume(0.05); return;
      }
      if (matchesShortcut(event, "video.volumeDown")) {
        event.preventDefault(); changeVolume(-0.05); return;
      }
      if (matchesShortcut(event, "video.mute")) { if (!event.repeat) toggleMute(); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration, playing]);

  const displayedCurrent = seeking ? (seekPreview ?? current) : current;
  const progressPct = duration > 0 ? Math.min(100, (displayedCurrent / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const seekSeconds = readSeekSeconds();

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={`video-player${compact ? " compact" : ""} ${showControls ? "controls-visible" : "controls-hidden"}`}
      onMouseMove={() => { setShowControls(true); scheduleHide(playing); }}
      onDoubleClick={(event) => { if (event.target === videoRef.current) toggleFullscreen(); }}
      onWheel={(event) => {
        event.preventDefault();
        if (Math.abs(event.deltaY) < 1) return;
        const now = performance.now();
        if (now - lastWheelChange.current < 80) return;
        lastWheelChange.current = now;
        changeVolume(event.deltaY < 0 ? 0.05 : -0.05);
        setShowControls(true);
        scheduleHide(playing);
      }}
    >
      <video
        ref={videoRef}
        src={playback.src}
        autoPlay={autoPlay}
        preload="auto"
        playsInline
        onCanPlay={() => { if (autoPlay && videoRef.current?.paused) void videoRef.current.play().catch(() => undefined); }}
        onEnded={onEnded}
        onClick={() => {
          togglePlay();
          containerRef.current?.focus({ preventScroll: true });
        }}
        onLoadedMetadata={(event) => {
          // Some browsers play the audio track of an unsupported MP4 while
          // silently dropping its video, so no media-error event is emitted.
          if (itemId && !playback.compatible && event.currentTarget.videoWidth === 0) {
            requestCompatiblePlayback();
            return;
          }
          if (resumeTime.current > 0) {
            event.currentTarget.currentTime = Math.min(resumeTime.current, event.currentTarget.duration || resumeTime.current);
            resumeTime.current = 0;
          }
        }}
        onError={() => {
          if (playback.preparing || playback.error) return;
          if (itemId && !playback.compatible) {
            requestCompatiblePlayback();
          } else onError("This video could not be played. Try downloading the original file.");
        }}
      />

      {(playback.preparing || playback.error) && <div className="video-preparing" role="status" aria-live="polite">
        {playback.preparing ? <><LoaderCircle className="spin" size={28} /><strong>{playback.queued ? "Waiting to prepare this video…" : "Preparing this video for playback…"}</strong>{playback.percent > 0 && <span>{playback.percent}%</span>}<small>Larger videos take longer to prepare. The prepared copy is saved for next time.</small></>
          : <><p>{playback.error}</p><button className="secondary-button" type="button" onClick={playback.retry}>Retry playback</button>{itemId && <a className="secondary-button" href={`/api/items/${itemId}/file`} download>Download original</a>}</>}
      </div>}

      {volumeFeedback !== null && <div className="video-volume-feedback" role="status" aria-live="polite">Volume {volumeFeedback}%</div>}

      <div className="video-controls">
        <div className="video-progress">
          <div className="video-progress-track">
            <div className="video-progress-buffered" style={{ width: `${bufferedPct}%` }} />
            <div className="video-progress-played" style={{ width: `${progressPct}%` }} />
          </div>
          <input
            className="video-progress-input"
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={displayedCurrent}
            onChange={(event) => handleSeekInput(Number(event.target.value))}
            onPointerUp={commitSeek}
            onPointerCancel={commitSeek}
            onKeyUp={commitSeek}
            onBlur={commitSeek}
            aria-label="Seek"
          />
        </div>
        <div className="video-controls-row">
          <button type="button" className="icon-button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <button type="button" className="icon-button" onClick={() => seekBy(-seekSeconds)} aria-label={`Back ${seekSeconds} seconds`}>-{seekLabel(seekSeconds)}</button>
          <button type="button" className="icon-button" onClick={() => seekBy(seekSeconds)} aria-label={`Forward ${seekSeconds} seconds`}>+{seekLabel(seekSeconds)}</button>
          <span className="video-time">{formatTime(displayedCurrent)} / {formatTime(duration)}</span>
          <div className="video-volume">
            <button type="button" className="icon-button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"}>
              <VolumeIcon size={19} />
            </button>
            <input
              className="video-volume-input"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={muted ? 0 : volume}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (videoRef.current) {
                  videoRef.current.volume = value;
                  videoRef.current.muted = value === 0;
                  showVolumeFeedback(value);
                }
              }}
              onPointerUp={() => containerRef.current?.focus({ preventScroll: true })}
              aria-label="Volume"
            />
          </div>
          <div className="video-controls-spacer" />
          {itemId && !playback.compatible && <button type="button" className="icon-button" title="Use compatibility mode if video or audio does not play correctly" aria-label="Use compatibility mode" onClick={requestCompatiblePlayback}><RefreshCw size={19} /></button>}
          <button type="button" className="icon-button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>
        </div>
      </div>
    </div>
  );
}
