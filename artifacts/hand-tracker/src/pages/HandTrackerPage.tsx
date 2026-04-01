import { useRef, useEffect, useState, useCallback } from "react";
import { Landmark, HandResult, CONNECTIONS, FINGER_NAMES, getExtendedFingers } from "@/hooks/useHandTracking";

declare global {
  interface Window {
    Hands: any;
    Camera: any;
  }
}

type TrackingMode = "skeleton" | "heatmap" | "minimal";
type AppMode = "track" | "draw";

const PALETTE = [
  "#f8fafc",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#38bdf8",
  "#818cf8",
  "#ec4899",
  "#a78bfa",
];

const BRUSH_SIZES = [4, 8, 16, 28];

function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  handedness: "Left" | "Right",
  width: number,
  height: number,
  mode: TrackingMode,
  extended: boolean[]
) {
  const color = handedness === "Right" ? "#38bdf8" : "#a78bfa";
  const tipColor = handedness === "Right" ? "#0ea5e9" : "#7c3aed";

  if (mode === "skeleton" || mode === "minimal") {
    ctx.lineWidth = mode === "minimal" ? 2 : 3;
    ctx.strokeStyle = color + "99";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const [a, b] of CONNECTIONS) {
      const p1 = landmarks[a];
      const p2 = landmarks[b];
      ctx.beginPath();
      ctx.moveTo(p1.x * width, p1.y * height);
      ctx.lineTo(p2.x * width, p2.y * height);
      ctx.stroke();
    }

    const fingertips = [4, 8, 12, 16, 20];
    landmarks.forEach((lm, i) => {
      const x = lm.x * width;
      const y = lm.y * height;
      const isTip = fingertips.includes(i);
      const fingerIdx = fingertips.indexOf(i);
      const isExtended = isTip && fingerIdx >= 0 && extended[fingerIdx];
      if (mode === "minimal" && !isTip) return;
      ctx.beginPath();
      const radius = isTip ? (mode === "minimal" ? 8 : 10) : (mode === "minimal" ? 3 : 5);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      if (isTip) {
        ctx.fillStyle = isExtended ? "#22c55e" : tipColor;
        ctx.shadowColor = isExtended ? "#22c55e" : tipColor;
        ctx.shadowBlur = 12;
      } else {
        ctx.fillStyle = color;
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      }
      ctx.fill();
      ctx.shadowBlur = 0;
      if (isTip && mode !== "minimal") {
        ctx.strokeStyle = isExtended ? "#16a34a" : color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    });
  } else if (mode === "heatmap") {
    landmarks.forEach((lm) => {
      const x = lm.x * width;
      const y = lm.y * height;
      const depth = (lm.z + 0.15) / 0.3;
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, 30);
      const h = handedness === "Right" ? "199" : "271";
      gradient.addColorStop(0, `hsla(${h}, 89%, 60%, ${Math.max(0.1, 1 - depth)})`);
      gradient.addColorStop(1, `hsla(${h}, 89%, 40%, 0)`);
      ctx.beginPath();
      ctx.arc(x, y, 30, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();
    });
  }
}

function isDrawGesture(landmarks: Landmark[], handedness: "Left" | "Right"): boolean {
  const extended = getExtendedFingers(landmarks, handedness);
  return extended[1] && !extended[2] && !extended[3] && !extended[4];
}

function isPauseGesture(landmarks: Landmark[], handedness: "Left" | "Right"): boolean {
  const extended = getExtendedFingers(landmarks, handedness);
  const upCount = extended.filter(Boolean).length;
  return upCount >= 3;
}

export default function HandTrackerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  const [status, setStatus] = useState<"idle" | "loading" | "active" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [hands, setHands] = useState<HandResult[]>([]);
  const [trackMode, setTrackMode] = useState<TrackingMode>("skeleton");
  const [appMode, setAppMode] = useState<AppMode>("track");
  const [showVideo, setShowVideo] = useState(true);
  const [fps, setFps] = useState(0);
  const [drawColor, setDrawColor] = useState("#f8fafc");
  const [brushSize, setBrushSize] = useState(8);
  const [isEraser, setIsEraser] = useState(false);
  const [isActivelyDrawing, setIsActivelyDrawing] = useState(false);
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);

  const fpsRef = useRef({ frames: 0, last: Date.now() });
  const prevPointRef = useRef<{ x: number; y: number } | null>(null);
  const drawColorRef = useRef(drawColor);
  const brushSizeRef = useRef(brushSize);
  const isEraserRef = useRef(isEraser);
  const appModeRef = useRef(appMode);
  const trackModeRef = useRef(trackMode);
  const undoStackRef = useRef(undoStack);

  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  useEffect(() => { brushSizeRef.current = brushSize; }, [brushSize]);
  useEffect(() => { isEraserRef.current = isEraser; }, [isEraser]);
  useEffect(() => { appModeRef.current = appMode; }, [appMode]);
  useEffect(() => { trackModeRef.current = trackMode; }, [trackMode]);
  useEffect(() => { undoStackRef.current = undoStack; }, [undoStack]);

  const saveUndoState = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snapshot = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setUndoStack(prev => [...prev.slice(-19), snapshot]);
  }, []);

  const undo = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (undoStackRef.current.length === 0) return;
    const prev = [...undoStackRef.current];
    const last = prev.pop()!;
    setUndoStack(prev);
    ctx.putImageData(last, 0, 0);
  }, []);

  const clearDrawing = useCallback(() => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    saveUndoState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [saveUndoState]);

  const drawStrokeSegment = useCallback((
    x1: number, y1: number,
    x2: number, y2: number
  ) => {
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const size = brushSizeRef.current;
    if (isEraserRef.current) {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = size * 3;
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = size;
      ctx.strokeStyle = drawColorRef.current;
    }

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = isEraserRef.current ? "transparent" : drawColorRef.current;
    ctx.shadowBlur = isEraserRef.current ? 0 : size * 0.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = "source-over";
  }, []);

  const onResults = useCallback((results: any) => {
    const overlay = overlayCanvasRef.current;
    const cursor = cursorCanvasRef.current;
    if (!overlay || !cursor) return;
    const ctx = overlay.getContext("2d");
    const curCtx = cursor.getContext("2d");
    if (!ctx || !curCtx) return;

    fpsRef.current.frames++;
    const now = Date.now();
    if (now - fpsRef.current.last >= 1000) {
      setFps(fpsRef.current.frames);
      fpsRef.current.frames = 0;
      fpsRef.current.last = now;
    }

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    curCtx.clearRect(0, 0, cursor.width, cursor.height);

    const detectedHands: HandResult[] = [];
    let activelyDrawingThisFrame = false;

    if (results.multiHandLandmarks?.length > 0) {
      results.multiHandLandmarks.forEach((landmarks: Landmark[], idx: number) => {
        const handedness = results.multiHandedness?.[idx]?.label || "Right";
        const extended = getExtendedFingers(landmarks, handedness as "Left" | "Right");
        drawHandOverlay(ctx, landmarks, handedness as "Left" | "Right", overlay.width, overlay.height, trackModeRef.current, extended);
        detectedHands.push({ landmarks, handedness: handedness as "Left" | "Right" });

        if (appModeRef.current === "draw") {
          const tip = landmarks[8];
          const px = tip.x * overlay.width;
          const py = tip.y * overlay.height;

          const drawing = isDrawGesture(landmarks, handedness as "Left" | "Right");
          const pausing = isPauseGesture(landmarks, handedness as "Left" | "Right");

          if (pausing) {
            prevPointRef.current = null;
          } else if (drawing) {
            activelyDrawingThisFrame = true;
            if (prevPointRef.current) {
              if (!prevPointRef.current || Math.abs(prevPointRef.current.x - px) > 100 || Math.abs(prevPointRef.current.y - py) > 100) {
                prevPointRef.current = { x: px, y: py };
              } else {
                drawStrokeSegment(prevPointRef.current.x, prevPointRef.current.y, px, py);
              }
            } else {
              saveUndoState();
            }
            prevPointRef.current = { x: px, y: py };

            curCtx.beginPath();
            curCtx.arc(px, py, brushSizeRef.current / 2 + 6, 0, Math.PI * 2);
            curCtx.strokeStyle = isEraserRef.current ? "rgba(255,255,255,0.6)" : drawColorRef.current;
            curCtx.lineWidth = 2;
            curCtx.stroke();
            curCtx.beginPath();
            curCtx.arc(px, py, 3, 0, Math.PI * 2);
            curCtx.fillStyle = isEraserRef.current ? "white" : drawColorRef.current;
            curCtx.fill();
          } else {
            prevPointRef.current = null;
            curCtx.beginPath();
            curCtx.arc(px, py, brushSizeRef.current / 2 + 4, 0, Math.PI * 2);
            curCtx.strokeStyle = "rgba(255,255,255,0.3)";
            curCtx.lineWidth = 1.5;
            curCtx.setLineDash([4, 4]);
            curCtx.stroke();
            curCtx.setLineDash([]);
          }
        }
      });
    } else {
      prevPointRef.current = null;
    }

    setIsActivelyDrawing(activelyDrawingThisFrame);
    setHands(detectedHands);
  }, [drawStrokeSegment, saveUndoState]);

  const startTracking = useCallback(async () => {
    if (status === "active") return;
    setStatus("loading");
    setError(null);

    try {
      if (!window.Hands || !window.Camera) {
        await new Promise<void>((resolve, reject) => {
          const scripts = [
            "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js",
            "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js",
          ];
          let loaded = 0;
          scripts.forEach((src) => {
            const s = document.createElement("script");
            s.src = src;
            s.crossOrigin = "anonymous";
            s.onload = () => { loaded++; if (loaded === scripts.length) resolve(); };
            s.onerror = () => reject(new Error("Failed to load MediaPipe"));
            document.head.appendChild(s);
          });
        });
      }

      await new Promise(r => setTimeout(r, 500));

      const hands = new window.Hands({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${file}`,
      });

      hands.setOptions({
        maxNumHands: 2,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.5,
      });

      hands.onResults(onResults);
      await hands.initialize();
      handsRef.current = hands;

      const video = videoRef.current!;
      const camera = new window.Camera(video, {
        onFrame: async () => { await handsRef.current?.send({ image: video }); },
        width: 1280,
        height: 720,
      });

      await camera.start();
      cameraRef.current = camera;
      setStatus("active");
    } catch (e: any) {
      setError(e?.message || "Camera access denied or not available");
      setStatus("error");
    }
  }, [status, onResults]);

  const stopTracking = useCallback(() => {
    cameraRef.current?.stop();
    handsRef.current?.close();
    cameraRef.current = null;
    handsRef.current = null;
    setHands([]);
    setStatus("idle");
    prevPointRef.current = null;
    overlayCanvasRef.current?.getContext("2d")?.clearRect(0, 0, 1280, 720);
    cursorCanvasRef.current?.getContext("2d")?.clearRect(0, 0, 1280, 720);
  }, []);

  useEffect(() => {
    if (handsRef.current) handsRef.current.onResults(onResults);
  }, [onResults]);

  useEffect(() => () => { stopTracking(); }, []);

  const extendedCount = hands.reduce((sum, h) => sum + getExtendedFingers(h.landmarks, h.handedness).filter(Boolean).length, 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm px-4 py-3 flex items-center justify-between sticky top-0 z-20">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/20 border border-primary/30 flex items-center justify-center">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v3" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-foreground leading-none">Hand Tracker</h1>
            <p className="text-xs text-muted-foreground mt-0.5">Draw with your index finger</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {status === "active" && (
            <div className="flex items-center gap-1 bg-muted/40 rounded-lg p-1">
              {(["track", "draw"] as AppMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => { setAppMode(m); prevPointRef.current = null; }}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-all capitalize ${appMode === m ? "bg-primary text-primary-foreground shadow" : "text-muted-foreground hover:text-foreground"}`}
                >
                  {m === "draw" ? "Draw" : "Track"}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            {status === "active" && (
              <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-1 rounded">{fps} fps</span>
            )}
            <div className={`w-2 h-2 rounded-full ${status === "active" ? "bg-green-500 animate-pulse" : status === "loading" ? "bg-yellow-500 animate-pulse" : status === "error" ? "bg-destructive" : "bg-muted-foreground"}`} />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col lg:flex-row">
        <div className="flex-1 relative bg-black flex items-center justify-center min-h-[50vh] lg:min-h-0">
          <video ref={videoRef} autoPlay playsInline muted
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${showVideo && status === "active" ? "opacity-100" : "opacity-0"}`}
            style={{ transform: "scaleX(-1)" }}
          />
          <canvas ref={drawingCanvasRef} width={1280} height={720}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
          <canvas ref={overlayCanvasRef} width={1280} height={720}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />
          <canvas ref={cursorCanvasRef} width={1280} height={720}
            className="absolute inset-0 w-full h-full object-cover"
            style={{ transform: "scaleX(-1)" }}
          />

          {status === "idle" && (
            <div className="relative z-10 text-center px-8">
              <div className="w-20 h-20 mx-auto mb-6 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
                  <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v3" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-foreground mb-2">Hand Tracker + Draw</h2>
              <p className="text-muted-foreground mb-8 max-w-sm mx-auto text-sm leading-relaxed">
                Track your hands in real time, or switch to Draw mode to paint with your index finger.
              </p>
              <button onClick={startTracking} className="bg-primary text-primary-foreground font-semibold px-8 py-3 rounded-xl hover:opacity-90 transition-all duration-200 text-sm shadow-lg shadow-primary/30">
                Start Camera
              </button>
            </div>
          )}

          {status === "loading" && (
            <div className="relative z-10 text-center">
              <div className="w-12 h-12 mx-auto mb-4 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
              <p className="text-foreground font-medium text-sm">Loading MediaPipe...</p>
              <p className="text-muted-foreground text-xs mt-1">This takes a few seconds</p>
            </div>
          )}

          {status === "error" && (
            <div className="relative z-10 text-center px-8">
              <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-destructive">
                  <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <h3 className="text-foreground font-semibold mb-2">Camera Error</h3>
              <p className="text-muted-foreground text-sm mb-6">{error}</p>
              <button onClick={startTracking} className="bg-primary text-primary-foreground font-semibold px-6 py-2.5 rounded-xl hover:opacity-90 transition-all text-sm">Try Again</button>
            </div>
          )}

          {status === "active" && appMode === "draw" && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10 pointer-events-none">
              <div className={`px-4 py-2 rounded-full text-xs font-semibold backdrop-blur-sm border transition-all duration-300 ${isActivelyDrawing ? "bg-green-500/20 border-green-500/40 text-green-300" : "bg-black/40 border-white/10 text-white/60"}`}>
                {isActivelyDrawing ? "Drawing..." : "☝ Point one finger to draw · ✋ 3+ fingers to pause"}
              </div>
            </div>
          )}

          {status === "active" && (
            <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end pointer-events-none z-10">
              <div className="flex gap-2 pointer-events-auto">
                {(["skeleton", "heatmap", "minimal"] as TrackingMode[]).map((m) => (
                  <button key={m} onClick={() => setTrackMode(m)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${trackMode === m ? "bg-primary/90 text-primary-foreground" : "bg-black/50 text-white/70 hover:bg-black/70 backdrop-blur-sm"}`}>
                    {m}
                  </button>
                ))}
              </div>
              <div className="flex gap-2 pointer-events-auto">
                <button onClick={() => setShowVideo(v => !v)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-black/50 text-white/70 hover:bg-black/70 backdrop-blur-sm transition-all">
                  {showVideo ? "Hide" : "Show"} Video
                </button>
                <button onClick={stopTracking}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-destructive/80 text-white hover:bg-destructive backdrop-blur-sm transition-all">
                  Stop
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="w-full lg:w-72 border-t lg:border-t-0 lg:border-l border-border bg-card flex flex-col">
          {appMode === "draw" && status === "active" ? (
            <>
              <div className="p-4 border-b border-border">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Draw Tools</h2>

                <div className="space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Color</p>
                    <div className="flex flex-wrap gap-2">
                      {PALETTE.map((c) => (
                        <button
                          key={c}
                          onClick={() => { setDrawColor(c); setIsEraser(false); }}
                          className="w-7 h-7 rounded-full border-2 transition-all duration-150 hover:scale-110"
                          style={{
                            backgroundColor: c,
                            borderColor: drawColor === c && !isEraser ? "white" : "transparent",
                            boxShadow: drawColor === c && !isEraser ? `0 0 0 2px ${c}55` : "none",
                          }}
                        />
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Brush Size</p>
                    <div className="flex gap-2 items-center">
                      {BRUSH_SIZES.map((s) => (
                        <button
                          key={s}
                          onClick={() => setBrushSize(s)}
                          className={`rounded-full flex items-center justify-center transition-all duration-150 hover:scale-110 border-2 ${brushSize === s ? "border-primary bg-primary/20" : "border-border bg-muted/30"}`}
                          style={{ width: 32, height: 32 }}
                        >
                          <div className="rounded-full bg-foreground" style={{ width: s / 2 + 4, height: s / 2 + 4 }} />
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-muted-foreground mb-2">Tool</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setIsEraser(false)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${!isEraser ? "bg-primary/20 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                      >
                        Brush
                      </button>
                      <button
                        onClick={() => setIsEraser(true)}
                        className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all border ${isEraser ? "bg-primary/20 border-primary/40 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`}
                      >
                        Eraser
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 border-b border-border">
                <div className="flex gap-2">
                  <button
                    onClick={undo}
                    disabled={undoStack.length === 0}
                    className="flex-1 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-foreground disabled:opacity-30 transition-all"
                  >
                    Undo
                  </button>
                  <button
                    onClick={clearDrawing}
                    className="flex-1 py-2 rounded-lg text-xs font-medium border border-border text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-all"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="p-4 flex-1">
                <div className="rounded-xl border border-border bg-background/50 p-4 space-y-3">
                  <p className="text-xs font-semibold text-foreground">How to draw</p>
                  <div className="space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-green-500/15 border border-green-500/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs">☝</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">Point your <strong className="text-foreground">index finger</strong> to draw</p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-blue-500/15 border border-blue-500/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs">✋</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">Raise <strong className="text-foreground">3+ fingers</strong> to pause drawing</p>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <div className="w-6 h-6 rounded-md bg-violet-500/15 border border-violet-500/25 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-xs">✌</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">Use other gestures to hover without drawing</p>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="p-4 border-b border-border">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Detection</h2>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {hands.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-muted/50 flex items-center justify-center">
                      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground">
                        <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v3" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
                      </svg>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {status === "active" ? "No hands detected" : "Start camera to begin"}
                    </p>
                  </div>
                ) : (
                  hands.map((hand, idx) => {
                    const extended = getExtendedFingers(hand.landmarks, hand.handedness);
                    const count = extended.filter(Boolean).length;
                    const isRight = hand.handedness === "Right";
                    return (
                      <div key={idx} className="rounded-xl border border-border bg-background/50 overflow-hidden">
                        <div className={`px-4 py-3 flex items-center justify-between ${isRight ? "bg-sky-500/10 border-b border-sky-500/20" : "bg-violet-500/10 border-b border-violet-500/20"}`}>
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${isRight ? "bg-sky-400" : "bg-violet-400"}`} />
                            <span className="text-sm font-semibold text-foreground">{hand.handedness} Hand</span>
                          </div>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isRight ? "bg-sky-500/20 text-sky-300" : "bg-violet-500/20 text-violet-300"}`}>{count} up</span>
                        </div>
                        <div className="p-3 space-y-2">
                          {FINGER_NAMES.map((name, fi) => (
                            <div key={name} className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">{name}</span>
                              <div className={`w-5 h-5 rounded-md flex items-center justify-center text-xs font-bold transition-colors duration-150 ${extended[fi] ? "bg-green-500/20 text-green-400 border border-green-500/30" : "bg-muted/50 text-muted-foreground"}`}>
                                {extended[fi] ? "↑" : "·"}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="px-3 pb-3">
                          <div className="rounded-lg bg-muted/30 p-2.5 space-y-1.5">
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Wrist X</span>
                              <span className="font-mono text-foreground">{(hand.landmarks[0].x * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Wrist Y</span>
                              <span className="font-mono text-foreground">{(hand.landmarks[0].y * 100).toFixed(1)}%</span>
                            </div>
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Depth Z</span>
                              <span className="font-mono text-foreground">{hand.landmarks[0].z.toFixed(3)}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              <div className="p-4 border-t border-border">
                <div className="grid grid-cols-2 gap-2 text-center">
                  <div className="rounded-lg bg-muted/30 p-2.5">
                    <div className="text-xl font-bold text-foreground">{hands.length}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Hands</div>
                  </div>
                  <div className="rounded-lg bg-muted/30 p-2.5">
                    <div className="text-xl font-bold text-foreground">{extendedCount}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">Fingers Up</div>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
