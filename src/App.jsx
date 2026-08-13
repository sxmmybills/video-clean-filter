import { useState, useRef, useCallback, useEffect } from "react";

const FILTERS = [
  { id: "none", label: "None", css: "none", desc: "Strip metadata only", emoji: "🚫" },
  { id: "warm", label: "Warm", css: "sepia(0.1) saturate(1.06)", desc: "Golden tone", emoji: "🔥" },
  { id: "cool", label: "Cool", css: "hue-rotate(15deg) saturate(1.03) brightness(1.01)", desc: "Blue shift", emoji: "❄️" },
  { id: "vintage", label: "Vintage", css: "sepia(0.08) contrast(1.03) saturate(0.92) brightness(1.02)", desc: "Retro fade", emoji: "📷" },
  { id: "dramatic", label: "Dramatic", css: "contrast(1.08) saturate(1.06)", desc: "Bold punch", emoji: "🎭" },
  { id: "greyscale", label: "Greyscale", css: "grayscale(0.1)", desc: "B&W blend", emoji: "🌑" },
  { id: "summer", label: "Summer", css: "sepia(0.05) saturate(1.1) brightness(1.03)", desc: "Bright & warm", emoji: "☀️" },
  { id: "moody", label: "Moody", css: "contrast(1.06) brightness(0.96) saturate(0.94) hue-rotate(5deg)", desc: "Dark & cool", emoji: "🌧️" },
];

export default function App() {
  const [file, setFile] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [filter, setFilter] = useState("warm");
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [outputUrl, setOutputUrl] = useState(null);
  const [outputType, setOutputType] = useState("video/webm");
  const [error, setError] = useState("");
  const [videoDims, setVideoDims] = useState({ w: 0, h: 0 });
  const [videoDur, setVideoDur] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const audioCtxRef = useRef(null);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      try { recorderRef.current.stop(); } catch {}
    }
    if (audioCtxRef.current) {
      try { audioCtxRef.current.close(); } catch {}
      audioCtxRef.current = null;
    }
  }, []);

  useEffect(() => () => {
    cleanup();
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
  }, []);

  const handleFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError("Please select a video file");
      return;
    }
    cleanup();
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(f);
    setVideoSrc(URL.createObjectURL(f));
    setPhase("ready");
    setOutputUrl(null);
    setProgress(0);
    setError("");
  };

  const onDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };

  const onVideoLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    setVideoDims({ w: v.videoWidth, h: v.videoHeight });
    setVideoDur(v.duration);
  };

  const getSupportedMime = () => {
    const types = [
      "video/mp4;codecs=avc1",
      "video/mp4",
      "video/webm;codecs=vp9,opus",
      "video/webm;codecs=vp9",
      "video/webm;codecs=vp8,opus",
      "video/webm;codecs=vp8",
      "video/webm",
    ];
    for (const t of types) {
      if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) return t;
    }
    return "";
  };

  const getFileExt = (mime) => {
    if (mime.includes("mp4")) return "mp4";
    return "webm";
  };

  const process = async () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    if (typeof MediaRecorder === "undefined") {
      setError("Your browser doesn't support MediaRecorder. Try Chrome or Safari 14+.");
      return;
    }

    const mime = getSupportedMime();
    if (!mime) {
      setError("No supported video codec found in your browser.");
      return;
    }

    setPhase("processing");
    setProgress(0);
    setError("");
    setOutputType(mime);

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    const filterObj = FILTERS.find((f) => f.id === filter) || FILTERS[0];
    const cssFilter = filterObj.css;

    const canvasStream = canvas.captureStream(30);
    let combinedStream = canvasStream;
    let gotAudio = false;

    // Method 1: captureStream() — works on Chrome/Android, not on Safari
    if (!gotAudio && (video.captureStream || video.mozCaptureStream)) {
      try {
        const videoStream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
        const audioTracks = videoStream.getAudioTracks();
        if (audioTracks.length > 0) {
          combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioTracks,
          ]);
          gotAudio = true;
        }
      } catch {
        // Not supported — try next method
      }
    }

    // Method 2: Web Audio API — works on Safari/iOS
    if (!gotAudio) {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = audioCtx;
        // Must resume after user gesture on mobile
        if (audioCtx.state === "suspended") {
          await audioCtx.resume();
        }
        const source = audioCtx.createMediaElementSource(video);
        const dest = audioCtx.createMediaStreamDestination();
        source.connect(dest);
        // Don't connect to audioCtx.destination — keeps processing silent
        const audioTracks = dest.stream.getAudioTracks();
        if (audioTracks.length > 0) {
          combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...audioTracks,
          ]);
          gotAudio = true;
        }
      } catch {
        // No audio capture available — video only
      }
    }

    const recorder = new MediaRecorder(combinedStream, {
      mimeType: mime,
      videoBitsPerSecond: 5_000_000,
    });
    recorderRef.current = recorder;
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mime });
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setPhase("done");
      setProgress(100);
      if (audioCtxRef.current) {
        try { audioCtxRef.current.close(); } catch {}
        audioCtxRef.current = null;
      }
    };

    recorder.onerror = () => {
      setError("Recording failed. Try a shorter video or different browser.");
      setPhase("ready");
    };

    const drawLoop = () => {
      if (video.paused || video.ended) return;
      ctx.filter = cssFilter;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (video.duration) {
        setProgress(Math.min(99, Math.round((video.currentTime / video.duration) * 100)));
      }
      rafRef.current = requestAnimationFrame(drawLoop);
    };

    // Use volume=0 instead of muted=true — muted can kill the captured audio stream on some browsers
    video.volume = 0;

    // Seek to start and wait for first frame before recording
    try {
      video.currentTime = 0;
      await new Promise((resolve) => {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          resolve();
        };
        video.addEventListener("seeked", onSeeked);
      });

      // Draw the first frame to canvas BEFORE starting the recorder
      ctx.filter = cssFilter;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Now start recording — canvas already has the first frame
      recorder.start(200);

      const onEnd = () => {
        cancelAnimationFrame(rafRef.current);
        ctx.filter = cssFilter;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        setTimeout(() => {
          if (recorder.state === "recording") recorder.stop();
        }, 300);
        video.removeEventListener("ended", onEnd);
      };
      video.addEventListener("ended", onEnd);

      await video.play();
      drawLoop();
    } catch {
      setError("Couldn't play video for processing. Try tapping Process again.");
      setPhase("ready");
    }
  };

  const download = () => {
    if (!outputUrl) return;
    const ext = getFileExt(outputType);
    const name = file ? file.name.replace(/\.[^.]+$/, "") + `_clean.${ext}` : `clean_video.${ext}`;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 200);
  };

  const openInNewTab = () => {
    if (!outputUrl) return;
    window.open(outputUrl, "_blank");
  };

  const reset = () => {
    cleanup();
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(null);
    setVideoSrc(null);
    setPhase("idle");
    setProgress(0);
    setOutputUrl(null);
    setError("");
  };

  const formatDur = (s) => {
    if (!s || !isFinite(s)) return "";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  const formatSize = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="wrap">
      <div className="header">
        <h1 className="title">Video Clean & Filter</h1>
        <p className="subtitle">Strip metadata · Apply filter · Download clean</p>
      </div>

      {phase === "idle" && (
        <label
          className="upload-area"
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          <input
            type="file"
            accept="video/*"
            style={{ display: "none" }}
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <div className="upload-icon">▶</div>
          <div className="upload-text">Tap to select video</div>
          <div className="upload-hint">MP4, MOV, WebM, AVI · drag & drop on desktop</div>
        </label>
      )}

      {phase !== "idle" && (
        <>
          <div className="preview-wrap">
            <video
              ref={videoRef}
              src={videoSrc}
              onLoadedMetadata={onVideoLoaded}
              playsInline
              preload="metadata"
              className="preview-video"
              controls={phase !== "processing"}
            />
            {file && (
              <div className="file-meta">
                <span>{file.name}</span>
                <span className="dot">·</span>
                <span>{formatSize(file.size)}</span>
                {videoDur > 0 && (
                  <>
                    <span className="dot">·</span>
                    <span>{formatDur(videoDur)}</span>
                  </>
                )}
                {videoDims.w > 0 && (
                  <>
                    <span className="dot">·</span>
                    <span>{videoDims.w}×{videoDims.h}</span>
                  </>
                )}
              </div>
            )}
          </div>

          <div className="meta-badge">
            <span>🛡️</span>
            <span>
              {phase === "done"
                ? "All personal metadata stripped"
                : "Metadata will be stripped automatically"}
            </span>
          </div>

          <div className="section">
            <div className="section-label">FILTER · 10% INTENSITY</div>
            <div className="filter-grid">
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => phase !== "processing" && setFilter(f.id)}
                  className={`filter-card ${filter === f.id ? "active" : ""}`}
                  disabled={phase === "processing"}
                >
                  <span className="filter-emoji">{f.emoji}</span>
                  <span className="filter-label">{f.label}</span>
                  <span className="filter-desc">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {phase === "processing" && (
            <div className="progress-wrap">
              <div className="progress-label">Processing… {progress}%</div>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${progress}%` }} />
              </div>
              <div className="progress-hint">
                Video plays through once to re-encode with filter.
                {videoDur > 60 && " This may take a minute for longer videos."}
              </div>
            </div>
          )}

          {error && <div className="error-box">{error}</div>}

          <div className="actions">
            {phase === "ready" && (
              <button onClick={process} className="btn primary">
                Clean & Filter
              </button>
            )}

            {phase === "done" && (
              <>
                <button onClick={download} className="btn primary">
                  Download Clean Video
                </button>
                <button onClick={openInNewTab} className="btn secondary">
                  Open in New Tab
                </button>
                <p className="save-hint">
                  On iPhone: tap "Open in New Tab" → long-press video → Save
                </p>
              </>
            )}

            {phase !== "processing" && (
              <button onClick={reset} className="btn ghost">
                {phase === "done" ? "Process Another" : "Change Video"}
              </button>
            )}
          </div>
        </>
      )}

      <canvas ref={canvasRef} style={{ display: "none" }} />

      <footer className="footer">
        Runs entirely in your browser — nothing uploaded anywhere.
      </footer>
    </div>
  );
}
