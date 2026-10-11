import { useEffect, useRef, useState } from "react";

export function VideoSeekPreview({ src, seconds, percent, label }: { src: string; seconds: number; percent: number; label: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const desired = useRef(seconds);
  const [failed, setFailed] = useState(false);
  desired.current = seconds;
  const seek = () => {
    const element = video.current;
    if (element && element.readyState >= 1 && !element.seeking) element.currentTime = Math.min(desired.current, Math.max(0, element.duration - .1));
  };
  useEffect(() => {
    const timer = window.setTimeout(seek, 120);
    return () => window.clearTimeout(timer);
  }, [seconds]);
  return <div className="video-seek-preview" style={{ left: `${Math.max(12, Math.min(88, percent))}%` }}>
    {!failed && <><video ref={video} src={src} muted playsInline preload="metadata" onLoadedMetadata={seek} onError={() => setFailed(true)} onSeeked={() => {
      const element = video.current, target = canvas.current;
      if (!element || !target) return;
      try {
        const context = target.getContext("2d");
        if (context && element.videoWidth && element.videoHeight) {
          const scale = Math.min(target.width / element.videoWidth, target.height / element.videoHeight);
          const width = element.videoWidth * scale, height = element.videoHeight * scale;
          context.fillStyle = "#000"; context.fillRect(0, 0, target.width, target.height);
          context.drawImage(element, (target.width - width) / 2, (target.height - height) / 2, width, height);
        }
      }
      catch { setFailed(true); }
      if (Math.abs(element.currentTime - desired.current) > .2) seek();
    }} /><canvas ref={canvas} width={192} height={108} /></>}
    <span>{label}</span>
  </div>;
}
