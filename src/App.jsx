import { useState, useRef, useEffect } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const CORE_VERSION = "0.12.6";

const FILTERS = [
  { id: "none", label: "None", ffmpeg: null, desc: "Strip metadata only", emoji: "🚫" },
  { id: "warm", label: "Warm", ffmpeg: "colorchannelmixer=rr=1.03:gg=1.01:bb=0.95,eq=saturation=1.03", desc: "Golden tone", emoji: "🔥" },
  { id: "cool", label: "Cool", ffmpeg: "colorchannelmixer=rr=0.96:gg=1.0:bb=1.05,eq=saturation=1.02", desc: "Blue shift", emoji: "❄️" },
  { id: "vintage", label: "Vintage", ffmpeg: "colorchannelmixer=rr=1.02:gg=1.0:bb=0.95:ra=0.02:ga=0.02:ba=0.02,eq=saturation=0.93:contrast=1.02", desc: "Retro fade", emoji: "📷" },
  { id: "dramatic", label: "Dramatic", ffmpeg: "eq=contrast=1.08:saturation=1.05", desc: "Bold punch", emoji: "🎭" },
  { id: "greyscale", label: "Greyscale", ffmpeg: "eq=saturation=0.9", desc: "B&W blend", emoji: "🌑" },
  { id: "summer", label: "Summer", ffmpeg: "colorchannelmixer=rr=1.04:gg=1.02:bb=0.96,eq=saturation=1.06:brightness=0.01", desc: "Bright & warm", emoji: "☀️" },
  { id: "moody", label: "Moody", ffmpeg: "colorchannelmixer=rr=0.98:gg=0.97:bb=1.04,eq=saturation=0.96:brightness=-0.01", desc: "Dark & cool", emoji: "🌧️" },
];

// Singleton FFmpeg instance
let ff = null;
let ffReady = false;

export default function App() {
  const [file, setFile] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [filter, setFilter] = useState("warm");
  const [phase, setPhase] = useState("idle"); // idle | ready | loading | processing | done | error
  const [progress, setProgress] = useState(0);
  const [statusMsg, setStatusMsg] = useState("");
  const [outputUrl, setOutputUrl] = useState(null);
  const [error, setError] = useState("");
  const [videoDims, setVideoDims] = useState({ w: 0, h: 0 });
  const [videoDur, setVideoDur] = useState(0);

  const videoRef = useRef(null);

  useEffect(() => {
    return () => {
      if (videoSrc) URL.revokeObjectURL(videoSrc);
      if (outputUrl) URL.revokeObjectURL(outputUrl);
    };
  }, []);

  const handleFile = (f) => {
    if (!f) return;
    if (!f.type.startsWith("video/")) {
      setError("Please select a video file");
      return;
    }
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(f);
    setVideoSrc(URL.createObjectURL(f));
    setPhase("ready");
    setOutputUrl(null);
    setProgress(0);
    setError("");
    setStatusMsg("");
  };

  const onDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };

  const onVideoLoaded = () => {
    const v = videoRef.current;
    if (!v) return;
    setVideoDims({ w: v.videoWidth, h: v.videoHeight });
    setVideoDur(v.duration);
  };

  const getInputExt = () => {
    if (!file) return "mp4";
    const name = file.name.toLowerCase();
    if (name.endsWith(".mov")) return "mov";
    if (name.endsWith(".avi")) return "avi";
    if (name.endsWith(".mkv")) return "mkv";
    if (name.endsWith(".webm")) return "webm";
    return "mp4";
  };

  const loadFFmpeg = async () => {
    if (ffReady && ff) return ff;

    setPhase("loading");
    setStatusMsg("Downloading processor (one-time)…");
    setProgress(0);

    try {
      ff = new FFmpeg();

      ff.on("log", ({ message }) => {
        console.log("[ffmpeg]", message);
      });

      // Try loading from unpkg first, then jsdelivr as fallback
      const cdns = [
        `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
        `https://cdn.jsdelivr.net/npm/@ffmpeg/core@${CORE_VERSION}/dist/umd`,
      ];

      let loaded = false;
      for (const base of cdns) {
        try {
          const coreURL = await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript");
          setProgress(50);
          const wasmURL = await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm");
          setProgress(90);
          await ff.load({ coreURL, wasmURL });
          loaded = true;
          break;
        } catch {
          console.warn(`Failed to load from ${base}, trying next…`);
        }
      }

      if (!loaded) throw new Error("All CDNs failed");

      ffReady = true;
      return ff;
    } catch (err) {
      console.error("FFmpeg load error:", err);
      setError("Failed to download the video processor. Check your internet and try again.");
      setPhase("ready");
      ff = null;
      ffReady = false;
      return null;
    }
  };

  const process = async () => {
    if (!file) return;
    setError("");

    const ffmpeg = await loadFFmpeg();
    if (!ffmpeg) return;

    setPhase("processing");
    setProgress(0);
    setStatusMsg("Processing video…");

    try {
      // Progress tracking
      ffmpeg.on("progress", ({ progress: p }) => {
        if (p > 0 && p <= 1) {
          setProgress(Math.round(Math.min(99, p * 100)));
        }
      });

      const ext = getInputExt();
      const inputName = `input.${ext}`;
      const outputName = "output.mp4";

      // Write input file to FFmpeg virtual filesystem
      setStatusMsg("Reading video…");
      await ffmpeg.writeFile(inputName, await fetchFile(file));

      // Build FFmpeg command
      const filterObj = FILTERS.find((f) => f.id === filter) || FILTERS[0];
      const cmd = ["-i", inputName];

      // Strip all metadata
      cmd.push("-map_metadata", "-1", "-fflags", "+bitexact");

      // Apply filter if selected
      if (filterObj.ffmpeg) {
        cmd.push("-vf", filterObj.ffmpeg);
      }

      // Encode as H.264/AAC — TikTok/Instagram/YouTube compatible
      cmd.push(
        "-c:v", "libx264",
        "-preset", "fast",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-y",
        outputName
      );

      setStatusMsg("Encoding…");
      await ffmpeg.exec(cmd);

      // Read output
      const data = await ffmpeg.readFile(outputName);
      if (outputUrl) URL.revokeObjectURL(outputUrl);
      const blob = new Blob([data.buffer], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);
      setOutputUrl(url);
      setPhase("done");
      setProgress(100);
      setStatusMsg("");

      // Cleanup virtual filesystem
      try {
        await ffmpeg.deleteFile(inputName);
        await ffmpeg.deleteFile(outputName);
      } catch {}

    } catch (err) {
      console.error("Processing error:", err);
      setError("Processing failed. The video format may not be supported, or your device ran out of memory. Try a shorter clip.");
      setPhase("ready");
    }
  };

  const download = () => {
    if (!outputUrl) return;
    const name = file ? file.name.replace(/\.[^.]+$/, "") + "_clean.mp4" : "clean_video.mp4";
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
    if (videoSrc) URL.revokeObjectURL(videoSrc);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setFile(null);
    setVideoSrc(null);
    setPhase("idle");
    setProgress(0);
    setOutputUrl(null);
    setError("");
    setStatusMsg("");
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

  const isWorking = phase === "loading" || phase === "processing";

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
              src={phase === "done" ? outputUrl : videoSrc}
              onLoadedMetadata={onVideoLoaded}
              playsInline
              preload="metadata"
              className="preview-video"
              controls={!isWorking}
            />
            {file && (
              <div className="file-meta">
                <span>{phase === "done" ? file.name.replace(/\.[^.]+$/, "") + "_clean.mp4" : file.name}</span>
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
                  onClick={() => !isWorking && setFilter(f.id)}
                  className={`filter-card ${filter === f.id ? "active" : ""}`}
                  disabled={isWorking}
                >
                  <span className="filter-emoji">{f.emoji}</span>
                  <span className="filter-label">{f.label}</span>
                  <span className="filter-desc">{f.desc}</span>
                </button>
              ))}
            </div>
          </div>

          {isWorking && (
            <div className="progress-wrap">
              <div className="progress-label">{statusMsg} {progress > 0 ? `${progress}%` : ""}</div>
              <div className="progress-track">
                <div className="progress-bar" style={{ width: `${progress}%` }} />
              </div>
              {phase === "loading" && (
                <div className="progress-hint">
                  First time only — gets cached for next time.
                </div>
              )}
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

            {!isWorking && (
              <button onClick={reset} className="btn ghost">
                {phase === "done" ? "Process Another" : "Change Video"}
              </button>
            )}
          </div>
        </>
      )}

      <footer className="footer">
        Runs entirely in your browser — nothing uploaded anywhere.
        {ffReady && " ⚡ Processor cached."}
      </footer>
    </div>
  );
}
