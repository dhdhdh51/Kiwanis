import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Check, Download, Gauge, Maximize, Minimize, Pause, PictureInPicture2, Play, Settings2, Volume1, Volume2, VolumeX } from 'lucide-react';
import { formatDuration } from '../../lib/format';
import type { PlaybackSource } from '../../lib/types';

interface Props {
  sources: PlaybackSource[];
  poster?: string | null;
  autoPlay?: boolean;
  downloadUrl?: string | null;
  className?: string;
  /** Duration from metadata, used when the stream lacks a duration header */
  knownDuration?: number | null;
  /** Fill the parent box instead of keeping a 16:9 frame (embed page) */
  fill?: boolean;
}

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

/**
 * Custom HTML5 player: streams directly from (signed) storage URLs using HTTP range requests,
 * so playback starts immediately without downloading the whole file.
 */
export function VideoPlayer({ sources, poster, autoPlay, downloadUrl, className, knownDuration, fill }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [src, setSrc] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(() => {
    try {
      return Number(localStorage.getItem('vv-volume') ?? 1);
    } catch {
      return 1;
    }
  });
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [menu, setMenu] = useState<null | 'speed' | 'quality'>(null);
  const [controls, setControls] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState(false);
  const pipSupported = typeof document !== 'undefined' && 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;

  const v = () => video.current!;

  const poke = useCallback(() => {
    setControls(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!video.current?.paused) {
        setControls(false);
        setMenu(null);
      }
    }, 2600);
  }, []);

  const toggle = useCallback(() => {
    const el = video.current;
    if (!el) return;
    if (el.paused) el.play().catch(() => undefined);
    else el.pause();
  }, []);

  const toggleFullscreen = useCallback(async () => {
    const el = wrap.current as (HTMLDivElement & { webkitRequestFullscreen?: () => void }) | null;
    const vid = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) return document.exitFullscreen();
    if (el?.requestFullscreen) return el.requestFullscreen().catch(() => vid?.webkitEnterFullscreen?.());
    vid?.webkitEnterFullscreen?.(); // iOS Safari
  }, []);

  const togglePip = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await v().requestPictureInPicture();
    } catch {
      /* not allowed */
    }
  };

  // Switch quality while preserving position and play state.
  const selectSource = (i: number) => {
    const el = v();
    const t = el.currentTime;
    const wasPlaying = !el.paused;
    setSrc(i);
    setMenu(null);
    requestAnimationFrame(() => {
      const once = () => {
        el.currentTime = t;
        if (wasPlaying) el.play().catch(() => undefined);
        el.removeEventListener('loadedmetadata', once);
      };
      el.addEventListener('loadedmetadata', once);
    });
  };

  useEffect(() => {
    const onFs = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  useEffect(() => {
    if (video.current) {
      video.current.volume = volume;
      video.current.muted = muted;
    }
    try {
      localStorage.setItem('vv-volume', String(volume));
    } catch {
      /* storage blocked (embedded) */
    }
  }, [volume, muted]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = rate;
  }, [rate, src]);

  // Keyboard shortcuts when the player (or its children) has focus.
  const onKey = (e: React.KeyboardEvent) => {
    const el = v();
    const k = e.key.toLowerCase();
    if ((e.target as HTMLElement).tagName === 'INPUT' && (k === 'arrowleft' || k === 'arrowright')) return;
    if (k === ' ' || k === 'k') toggle();
    else if (k === 'arrowright' || k === 'l') el.currentTime = Math.min(el.duration, el.currentTime + (k === 'l' ? 10 : 5));
    else if (k === 'arrowleft' || k === 'j') el.currentTime = Math.max(0, el.currentTime - (k === 'j' ? 10 : 5));
    else if (k === 'arrowup') setVolume((x) => Math.min(1, x + 0.1));
    else if (k === 'arrowdown') setVolume((x) => Math.max(0, x - 0.1));
    else if (k === 'f') void toggleFullscreen();
    else if (k === 'm') setMuted((m) => !m);
    else return;
    e.preventDefault();
    poke();
  };

  const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const pct = duration ? (time / duration) * 100 : 0;
  const bufPct = duration ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={wrap}
      tabIndex={0}
      onKeyDown={onKey}
      onMouseMove={poke}
      onTouchStart={poke}
      className={clsx('group relative overflow-hidden bg-black outline-none select-none', fullscreen ? 'h-screen w-screen' : fill ? 'h-full w-full' : 'aspect-video w-full', className, !controls && playing && 'cursor-none')}
    >
      <video
        ref={video}
        key={sources[src]?.url}
        src={sources[src]?.url}
        poster={poster ?? undefined}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        className="h-full w-full object-contain"
        onClick={toggle}
        onDoubleClick={() => void toggleFullscreen()}
        onPlay={() => (setPlaying(true), poke())}
        onPause={() => (setPlaying(false), setControls(true))}
        onTimeUpdate={(e) => setTime(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : (knownDuration ?? 0))}
        onLoadedMetadata={(e) => {
          setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : (knownDuration ?? 0));
          setError(false);
        }}
        onProgress={(e) => {
          const b = e.currentTarget.buffered;
          if (b.length) setBuffered(b.end(b.length - 1));
        }}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={() => setError(true)}
      />

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/85 p-6 text-center text-white">
          <AlertTriangle size={32} className="text-amber-400" />
          <p className="font-medium">This video can't be played in your browser</p>
          <p className="max-w-sm text-sm text-zinc-400">The format or codec isn't supported for in-browser playback. You can download it and play it locally.</p>
          {downloadUrl && (
            <a href={downloadUrl} className="btn-primary mt-1">
              <Download size={16} /> Download
            </a>
          )}
        </div>
      )}

      {!error && waiting && playing && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/20 border-t-white" />
        </div>
      )}

      {!error && !playing && (
        <button onClick={toggle} className="absolute inset-0 flex items-center justify-center" aria-label="Play">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-zinc-900 shadow-2xl transition group-hover:scale-105">
            <Play size={28} className="ml-1" fill="currentColor" />
          </span>
        </button>
      )}

      {!error && (
        <div
          className={clsx(
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3 pt-10 pb-2 text-white transition-opacity duration-200 sm:px-4',
            controls || !playing ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Seek bar */}
          <div className="relative flex h-4 items-center">
            <div className="absolute inset-x-0 h-1 rounded-full bg-white/20" />
            <div className="absolute h-1 rounded-full bg-white/35" style={{ width: `${bufPct}%` }} />
            <div className="absolute h-1 rounded-full bg-gradient-to-r from-brand-400 to-accent-400" style={{ width: `${pct}%` }} />
            <input
              type="range"
              aria-label="Seek"
              className="vv-range relative w-full"
              min={0}
              max={duration || 0}
              step="any"
              value={time}
              onChange={(e) => {
                const t = Number(e.target.value);
                v().currentTime = t;
                setTime(t);
              }}
            />
          </div>

          <div className="mt-1 flex items-center gap-1 sm:gap-2">
            <button className="rounded-lg p-2 hover:bg-white/15" onClick={toggle} aria-label={playing ? 'Pause' : 'Play'}>
              {playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
            </button>

            <div className="group/vol flex items-center">
              <button className="rounded-lg p-2 hover:bg-white/15" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'}>
                <VolumeIcon size={20} />
              </button>
              <input
                type="range"
                aria-label="Volume"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => {
                  setVolume(Number(e.target.value));
                  setMuted(false);
                }}
                className="vv-range hidden w-0 opacity-0 transition-all duration-200 group-hover/vol:w-20 group-hover/vol:opacity-100 focus:w-20 focus:opacity-100 sm:block [&::-webkit-slider-runnable-track]:bg-white/30"
              />
            </div>

            <span className="ml-1 text-xs tabular-nums sm:text-sm">
              {formatDuration(time)} <span className="text-white/50">/ {formatDuration(duration)}</span>
            </span>

            <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
              <div className="relative">
                <button className="flex items-center gap-1 rounded-lg p-2 text-xs font-semibold hover:bg-white/15" onClick={() => setMenu(menu === 'speed' ? null : 'speed')} aria-label="Playback speed">
                  <Gauge size={18} />
                  <span className="hidden sm:inline">{rate}×</span>
                </button>
                {menu === 'speed' && (
                  <div className="absolute right-0 bottom-11 w-32 rounded-xl bg-zinc-900/95 p-1 shadow-xl ring-1 ring-white/10 backdrop-blur">
                    {SPEEDS.map((s) => (
                      <button key={s} className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm hover:bg-white/10" onClick={() => (setRate(s), setMenu(null))}>
                        {s === 1 ? 'Normal' : `${s}×`} {rate === s && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {sources.length > 1 && (
                <div className="relative">
                  <button className="flex items-center gap-1 rounded-lg p-2 text-xs font-semibold hover:bg-white/15" onClick={() => setMenu(menu === 'quality' ? null : 'quality')} aria-label="Quality">
                    <Settings2 size={18} />
                    <span className="hidden sm:inline">{sources[src].height ? `${sources[src].height}p` : 'Auto'}</span>
                  </button>
                  {menu === 'quality' && (
                    <div className="absolute right-0 bottom-11 w-44 rounded-xl bg-zinc-900/95 p-1 shadow-xl ring-1 ring-white/10 backdrop-blur">
                      <div className="px-3 py-1 text-[11px] font-semibold tracking-wide text-white/50 uppercase">Quality</div>
                      {sources.map((s, i) => (
                        <button key={s.url} className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm hover:bg-white/10" onClick={() => selectSource(i)}>
                          {s.label} {src === i && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {pipSupported && (
                <button className="rounded-lg p-2 hover:bg-white/15" onClick={togglePip} aria-label="Picture in picture">
                  <PictureInPicture2 size={18} />
                </button>
              )}
              <button className="rounded-lg p-2 hover:bg-white/15" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}>
                {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
