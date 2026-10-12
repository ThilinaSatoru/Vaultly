import { Select } from "./Select";
import { ShortcutHelp } from "./ShortcutHelp";
import { trackVideoPosition } from "./video-position";
import { VideoAudioTrack } from "./VideoAudioTrack";
import { VideoSeekPreview } from "./VideoSeekPreview";
import { preferredSubtitle, preferredTrack, subtitleLanguage, trackPreference, type PlaybackTrack } from "./video-preferences";
import { vaultUrl } from "./vault-session";
import { vaultStorage } from "./vault-session";
import { ExternalLink, LoaderCircle, Maximize, Minimize, Pause, Play, Settings2, Volume1, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { matchesShortcut, readBooleanPreference, readNumberPreference, writePreference } from "./preferences";
import { api } from "./media";

interface VideoPlayerProps {
  src: string;
  itemId?: number;
  autoPlay: boolean;
  compact?: boolean;
  onEnded?: () => void;
  onError: (message: string) => void;
}

const readStoredVolume = () => {
  return readNumberPreference("vaultly.video.volume", 1, 0, 1);
};

const readStoredMuted = () => vaultStorage.getItem("vaultly.video.muted") === "true";
const readSeekSeconds = (large = false) => {
  const storedUnit = vaultStorage.getItem(large ? "vaultly.video.seekLargeUnit" : "vaultly.video.seekUnit");
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

export function VideoPlayer({ src, itemId, autoPlay, compact = false, onEnded, onError }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const seekPeekTimer = useRef<number | null>(null);
  const volumeTimer = useRef<number | null>(null);
  const lastWheelChange = useRef(0);
  const wantsPlayback = useRef(autoPlay);
  const [waitingToPlay, setWaitingToPlay] = useState(autoPlay);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(readStoredVolume);
  const [muted, setMuted] = useState(readStoredMuted);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [seeking, setSeeking] = useState(false);
  const [seekPreview, setSeekPreview] = useState<number | null>(null);
  const [volumeFeedback, setVolumeFeedback] = useState<number | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [openingPlayer, setOpeningPlayer] = useState(false);
  const [launchMessage, setLaunchMessage] = useState("");
  const [rate, setRate] = useState(() => readNumberPreference("vaultly.video.rate", 1, .25, 3));
  const [loop, setLoop] = useState(() => readBooleanPreference("vaultly.video.loop", false));
  const [fit, setFit] = useState(() => vaultStorage.getItem("vaultly.video.fit") === "cover" ? "cover" : "contain");
  const [previews, setPreviews] = useState(() => readBooleanPreference("vaultly.video.seekPreviews", true));
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [hoverSeek, setHoverSeek] = useState<{ seconds: number; percent: number } | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [audioTracks, setAudioTracks] = useState<PlaybackTrack[]>([]);
  const [audio, setAudio] = useState(-1);
  const [audioLoading, setAudioLoading] = useState(false);
  const externalAudio = itemId && audio >= 0 && audioTracks.length > 0 && audio !== (audioTracks.find((track) => track.default)?.index ?? audioTracks[0]?.index);
  const externalAudioRef = useRef(Boolean(externalAudio));
  externalAudioRef.current = Boolean(externalAudio);
  const [subtitles, setSubtitles] = useState<Array<PlaybackTrack & { url: string }>>([]);
  const [subtitle, setSubtitle] = useState(-1);
  const [subtitleSize, setSubtitleSize] = useState(() => readNumberPreference("vaultly.video.subtitleSize", 100, 50, 200));
  useEffect(() => {
    const controller = new AbortController();
    setSubtitles([]); setSubtitle(-1); setAudioTracks([]); setAudio(-1);
    if (itemId) void Promise.all([
      api<{ subtitles: string[] }>(`/api/items/${itemId}/subtitles`, { signal: controller.signal }).catch(() => ({ subtitles: [] })),
      api<{ audio: PlaybackTrack[]; subtitles: PlaybackTrack[] }>(`/api/items/${itemId}/tracks`, { signal: controller.signal }).catch(() => ({ audio: [], subtitles: [] })),
    ]).then(([sidecars, embedded]) => {
      if (controller.signal.aborted) return;
      const tracks = [
        ...sidecars.subtitles.map((name, index) => ({ index, title: name, language: subtitleLanguage(name), url: vaultUrl(`/api/items/${itemId}/subtitles/${index}`) })),
        ...embedded.subtitles.map((track, index) => ({ ...track, index: sidecars.subtitles.length + index, title: track.title || track.language, url: vaultUrl(`/api/items/${itemId}/embedded-subtitles/${track.index}`) })),
      ];
      setSubtitles(tracks);
      setSubtitle(preferredSubtitle(tracks, vaultStorage.getItem("vaultly.video.subtitleTrack")));
      setAudioTracks(embedded.audio);
      setAudio(preferredTrack(embedded.audio, vaultStorage.getItem("vaultly.video.audioTrack"), embedded.audio.find((track) => track.default)?.index ?? embedded.audio[0]?.index ?? -1));
    }).catch(() => undefined);
    return () => controller.abort();
  }, [itemId]);
  useEffect(() => {
    if (videoRef.current) { videoRef.current.volume = volume; videoRef.current.muted = Boolean(externalAudio) || muted; }
  }, [volume, muted, externalAudio]);
  useEffect(() => {
    if (!externalAudio && audioLoading) {
      setAudioLoading(false);
      if (wantsPlayback.current) void videoRef.current?.play().catch(() => undefined);
    }
  }, [externalAudio, audioLoading]);
  useEffect(() => { if (videoRef.current) videoRef.current.playbackRate = rate; }, [rate]);
  useEffect(() => {
    const tracks = videoRef.current?.textTracks;
    if (tracks) for (let index = 0; index < tracks.length; index++) tracks[index].mode = index === subtitle ? "showing" : "disabled";
  }, [subtitle, subtitles]);

  useEffect(() => {
    if (itemId && videoRef.current) return trackVideoPosition(videoRef.current, itemId);
  }, [itemId, src]);

  const handleUnsupported = () => {
    wantsPlayback.current = false;
    videoRef.current?.pause();
    setUnsupported(true);
    onError("");
  };
  const openDefaultPlayer = async () => {
    if (!itemId) return;
    wantsPlayback.current = false;
    videoRef.current?.pause();
    setOpeningPlayer(true);
    setLaunchMessage("");
    try {
      await api(`/api/items/${itemId}/open`, { method: "POST" });
      setLaunchMessage("Opened in your default player.");
    } catch (error) {
      setLaunchMessage(error instanceof Error ? error.message : "Could not open the default player.");
    } finally { setOpeningPlayer(false); }
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
    video.muted = Boolean(externalAudioRef.current) || muted;
    const onTimeUpdate = () => { if (!seeking) setCurrent(video.currentTime); };
    const onLoadedMeta = () => setDuration(Number.isFinite(video.duration) ? video.duration : 0);
    const onProgress = () => {
      if (video.buffered.length > 0) setBuffered(video.buffered.end(video.buffered.length - 1));
    };
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onVolume = () => {
      if (externalAudioRef.current) return;
      setVolume(video.volume);
      setMuted(video.muted);
      vaultStorage.setItem("vaultly.video.volume", String(video.volume));
      vaultStorage.setItem("vaultly.video.muted", String(video.muted));
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
    if (!unsupported && autoPlay && video?.paused) void video.play().catch(() => undefined);
  }, [autoPlay, src, unsupported]);

  useEffect(() => {
    const onFsChange = () => setFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const scheduleHide = (_isPlaying: boolean) => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (containerRef.current?.querySelector(".shortcut-help-popover")) { scheduleHide(_isPlaying); return; }
      if (document.activeElement?.getAttribute?.("role") === "combobox" && document.activeElement.getAttribute("aria-expanded") === "true") { scheduleHide(_isPlaying); return; }
      if (containerRef.current?.querySelector(".video-controls")?.contains(document.activeElement)) containerRef.current.focus({ preventScroll: true });
      setShowControls(false); setOptionsOpen(false); setHoverSeek(null);
    }, 1500);
  };

  useEffect(() => {
    scheduleHide(playing);
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [playing, fullscreen]);
  useEffect(() => () => {
    if (seekPeekTimer.current) window.clearTimeout(seekPeekTimer.current);
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
  }, []);

  const showActionFeedback = (message: string) => {
    setActionFeedback(message);
    if (seekPeekTimer.current) window.clearTimeout(seekPeekTimer.current);
    seekPeekTimer.current = window.setTimeout(() => setActionFeedback(null), 750);
  };
  const hideControls = () => {
    if (containerRef.current?.querySelector(".shortcut-help-popover")) return;
    if (document.activeElement?.getAttribute?.("role") === "combobox" && document.activeElement.getAttribute("aria-expanded") === "true") return;
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    setShowControls(false); setOptionsOpen(false); setHoverSeek(null);
  };
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (audioLoading) {
      wantsPlayback.current = !wantsPlayback.current; setWaitingToPlay(wantsPlayback.current);
      showActionFeedback(wantsPlayback.current ? "Play when ready" : "Paused"); return;
    }
    const paused = video.paused;
    wantsPlayback.current = paused; setWaitingToPlay(paused);
    if (paused) void video.play().catch(() => {}); else video.pause();
    showActionFeedback(paused ? "Play" : "Paused");
  };

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.min(Math.max(0, video.currentTime + delta), (duration || video.duration || Infinity));
    video.currentTime = target;
    setCurrent(target);
    showActionFeedback(`${delta < 0 ? "−" : "+"}${seekLabel(Math.abs(delta))} · ${formatTime(target)}`);
  };

  const changeVolume = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    const next = Math.min(1, Math.max(0, Math.round((volume + delta) * 100) / 100));
    setVolume(next); writePreference("vaultly.video.volume", next);
    if (next > 0) { setMuted(false); writePreference("vaultly.video.muted", false); }
    showVolumeFeedback(next);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    setMuted(!muted); writePreference("vaultly.video.muted", !muted);
    showVolumeFeedback(!muted ? 0 : volume);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    showActionFeedback(document.fullscreenElement === container ? "Exit fullscreen" : "Fullscreen");
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

  // Floating players only consume shortcuts while focused.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.defaultPrevented || target?.closest(".shortcut-help-popover")) return;
      if (compact && !containerRef.current?.contains(document.activeElement)) return;
      if (target?.closest(".viewer") && target.closest(".viewer") !== containerRef.current?.closest(".viewer")) return;
      if (target?.closest("input, textarea, select, [contenteditable], .dialog-backdrop, .management-drawer, .management-dock")) return;
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
  }, [duration, playing, compact, volume, muted, audioLoading]);

  const displayedCurrent = seeking ? (seekPreview ?? current) : current;
  const progressPct = duration > 0 ? Math.min(100, (displayedCurrent / duration) * 100) : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;
  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const seekSeconds = readSeekSeconds();

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      aria-label="Video player"
      onKeyDown={(event) => {
        scheduleHide(playing);
        if (event.key === "Tab" && !showControls && !event.shiftKey) {
          event.preventDefault(); setShowControls(true);
          window.requestAnimationFrame(() => containerRef.current?.querySelector<HTMLButtonElement>(".video-controls button")?.focus());
        }
      }}
      className={`video-player${compact ? " compact" : ""} ${showControls ? "controls-visible" : "controls-hidden"}`}
      style={{ "--subtitle-scale": subtitleSize / 100 } as CSSProperties}
      onMouseMove={() => { setShowControls(true); scheduleHide(playing); }}
      onPointerDown={() => scheduleHide(playing)}
      onMouseLeave={hideControls}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) hideControls(); }}
      onFocus={(event) => { if ((event.target as HTMLElement).closest(".video-controls")) { setShowControls(true); scheduleHide(playing); } }}
      onDoubleClick={(event) => { if (event.target === videoRef.current) toggleFullscreen(); }}
      onWheel={(event) => {
        if ((event.target as HTMLElement).closest(".video-options, input, select")) return;
        event.preventDefault();
        if (Math.abs(event.deltaY) < 1) return;
        const now = performance.now();
        if (now - lastWheelChange.current < 80) return;
        lastWheelChange.current = now;
        changeVolume(event.deltaY < 0 ? 0.05 : -0.05);

      }}
    >
      <video
        ref={videoRef}
        src={src}
        autoPlay={autoPlay && !unsupported}
        preload="auto"
        playsInline
        loop={loop}
        style={{ objectFit: fit as "contain" | "cover" }}
        onCanPlay={() => { if (!unsupported && autoPlay && wantsPlayback.current && !externalAudioRef.current && videoRef.current?.paused) void videoRef.current.play().catch(() => undefined); }}
        onEnded={() => { wantsPlayback.current = false; setWaitingToPlay(false); onEnded?.(); }}
        onClick={() => {
          togglePlay(); hideControls();
          containerRef.current?.focus({ preventScroll: true });
        }}
        onLoadedMetadata={(event) => {
          // Some browsers play the audio track of an unsupported MP4 while
          // silently dropping its video, so no media-error event is emitted.
          if (event.currentTarget.videoWidth === 0) handleUnsupported();
        }}
        onError={() => {
          handleUnsupported();
        }}
      >{subtitles.map((track, index) => <track key={track.url} kind="subtitles" label={track.title} srcLang={track.language} src={track.url} onLoad={(event) => { event.currentTarget.track.mode = index === subtitle ? "showing" : "disabled"; }} />)}</video>

      {externalAudio && <VideoAudioTrack key={`${itemId}:${audio}`} src={vaultUrl(`/api/items/${itemId}/audio/${audio}`)} videoRef={videoRef} wantsPlayback={wantsPlayback} volume={volume} muted={muted} rate={rate} onLoading={setAudioLoading} onError={() => { setAudio(audioTracks.find((track) => track.default)?.index ?? audioTracks[0]?.index ?? -1); setAudioLoading(false); setLaunchMessage("This audio track could not be played. Using the original audio."); }} />}
      {audioLoading && <div className="video-action-feedback" role="status">Preparing audio…</div>}
      {unsupported && <div className="video-external-fallback" role="status" aria-live="polite">
        <ExternalLink size={28} /><strong>This video needs another player</strong>
        <small>Open the original file in your default player. No video copy is created.</small>
        {itemId && <button className="secondary-button" type="button" onClick={() => void openDefaultPlayer()} disabled={openingPlayer}>
          {openingPlayer ? <LoaderCircle className="spin" size={17} /> : <ExternalLink size={17} />}{openingPlayer ? "Opening…" : "Open in default player"}
        </button>}
        {launchMessage && <small>{launchMessage}</small>}
        <a className="secondary-button" href={src} download>Download original</a>
        <ShortcutHelp kind="video" />
      </div>}

      {!unsupported && launchMessage && <div className="video-launch-status" role="status">{launchMessage}</div>}

      {volumeFeedback !== null && <div className="video-volume-feedback" role="status" aria-live="polite">Volume {volumeFeedback}%</div>}

      {actionFeedback && <div className="video-action-feedback" role="status">{actionFeedback}</div>}
      <div className="video-controls" hidden={unsupported} inert={!showControls}>

        <div className="video-progress" onPointerMove={(event) => {
          if (!duration) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const percent = Math.min(100, Math.max(0, (event.clientX - rect.left) / rect.width * 100));
          setHoverSeek({ seconds: duration * percent / 100, percent });
        }} onPointerLeave={() => setHoverSeek(null)}>
          {hoverSeek && (previews ? <VideoSeekPreview src={src} seconds={hoverSeek.seconds} percent={hoverSeek.percent} label={formatTime(hoverSeek.seconds)} /> : <span className="video-seek-time" style={{ left: `${Math.max(5, Math.min(95, hoverSeek.percent))}%` }}>{formatTime(hoverSeek.seconds)}</span>)}
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
          <button type="button" className="icon-button" onClick={togglePlay} aria-label={(audioLoading ? waitingToPlay : playing) ? "Pause" : "Play"}>
            {(audioLoading ? waitingToPlay : playing) ? <Pause size={20} /> : <Play size={20} />}
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
                  setVolume(value); setMuted(value === 0);
                  writePreference("vaultly.video.volume", value); writePreference("vaultly.video.muted", value === 0);
                  showVolumeFeedback(value);
                }
              }}
              onPointerUp={() => containerRef.current?.focus({ preventScroll: true })}
              aria-label="Volume"
            />
          </div>
          <div className="video-controls-spacer" />
          <ShortcutHelp kind="video" />
          <div className="video-track-switchers">
            <label className="video-track-switcher">Audio<Select aria-label="Audio track" disabled={!audioTracks.length} value={audio} onChange={(event) => { const value = Number(event.target.value); setLaunchMessage(""); setAudio(value); const track = audioTracks.find((track) => track.index === value); if (track) writePreference("vaultly.video.audioTrack", JSON.stringify(trackPreference(track))); }}>
              {!audioTracks.length && <option value={-1}>Default</option>}{audioTracks.map((track) => <option key={track.index} value={track.index}>{track.title || `Track ${audioTracks.indexOf(track) + 1}`} · {track.language}</option>)}
            </Select></label>
            <label className="video-track-switcher">CC<Select aria-label="Subtitles" value={subtitle} onChange={(event) => { const value = Number(event.target.value); setSubtitle(value); if (value >= 0) writePreference("vaultly.video.subtitleTrack", JSON.stringify(trackPreference(subtitles[value]!))); }}><option value={-1}>{subtitles.length ? "Off" : "None"}</option>{subtitles.map((track) => <option key={track.index} value={track.index}>{track.title} · {track.language}</option>)}</Select></label>
          </div>
          <button type="button" className="icon-button" aria-label="Player options" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}><Settings2 size={18} /></button>
          {optionsOpen && <div className="video-options" onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); hideControls(); containerRef.current?.focus(); } }}>
            <label>Speed<Select aria-label="Playback speed" value={rate} onChange={(event) => { const value = Number(event.target.value); setRate(value); writePreference("vaultly.video.rate", value); }}>{[.25, .5, .75, 1, 1.25, 1.5, 2, 3].map((value) => <option key={value} value={value}>{value}×</option>)}</Select></label>
            <label className="video-subtitle-size">Subtitle size <output>{subtitleSize}%</output><input type="range" aria-label="Subtitle size" min={50} max={200} step={5} value={subtitleSize} onChange={(event) => { const value = Number(event.target.value); setSubtitleSize(value); writePreference("vaultly.video.subtitleSize", value); }} /></label>
            <label>Picture<Select aria-label="Video fit" value={fit} onChange={(event) => { setFit(event.target.value); writePreference("vaultly.video.fit", event.target.value); }}><option value="contain">Fit</option><option value="cover">Fill</option></Select></label>
            <label>Repeat<input type="checkbox" aria-label="Repeat video" checked={loop} onChange={(event) => { setLoop(event.target.checked); writePreference("vaultly.video.loop", event.target.checked); }} /></label>
            <label>Seek previews<input type="checkbox" aria-label="Seek previews" checked={previews} onChange={(event) => { setPreviews(event.target.checked); writePreference("vaultly.video.seekPreviews", event.target.checked); }} /></label>
            <button type="button" className="video-hide-button" onClick={hideControls}>Hide controls now</button>
          </div>}
          {itemId && <button type="button" className="icon-button" title="Open the original video in your default player" aria-label="Open in default player" disabled={openingPlayer} onClick={() => void openDefaultPlayer()}><ExternalLink size={19} /></button>}
          <button type="button" className="icon-button" onClick={toggleFullscreen} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}>
            {fullscreen ? <Minimize size={19} /> : <Maximize size={19} />}
          </button>
        </div>
      </div>
    </div>
  );
}
