import { useRef, useEffect, useState, useCallback } from "react";
import { Landmark, CONNECTIONS, getExtendedFingers } from "@/hooks/useHandTracking";

declare global {
  interface Window { Hands: any; Camera: any; }
}

type AppMode = "track" | "draw";

const PALETTE = [
  "#ffffff", "#ff3b5c", "#ff9500", "#ffd60a",
  "#34c759", "#00c7be", "#0a84ff", "#bf5af2", "#ff375f",
];

const BRUSH_SIZES = [4, 10, 20, 36];

function drawHandOverlay(
  ctx: CanvasRenderingContext2D,
  landmarks: Landmark[],
  width: number,
  height: number,
  color: string,
  extended: boolean[]
) {
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color + "88";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  for (const [a, b] of CONNECTIONS) {
    ctx.beginPath();
    ctx.moveTo(landmarks[a].x * width, landmarks[a].y * height);
    ctx.lineTo(landmarks[b].x * width, landmarks[b].y * height);
    ctx.stroke();
  }

  const tips = [4, 8, 12, 16, 20];
  landmarks.forEach((lm, i) => {
    const x = lm.x * width;
    const y = lm.y * height;
    const tipIdx = tips.indexOf(i);
    const isTip = tipIdx >= 0;
    ctx.beginPath();
    ctx.arc(x, y, isTip ? 8 : 4, 0, Math.PI * 2);
    if (isTip && extended[tipIdx]) {
      ctx.fillStyle = "#22c55e";
      ctx.shadowColor = "#22c55e";
      ctx.shadowBlur = 10;
    } else {
      ctx.fillStyle = isTip ? color : color + "66";
      ctx.shadowBlur = 0;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  });
}

function isDrawGesture(landmarks: Landmark[], handedness: "Left" | "Right"): boolean {
  const ext = getExtendedFingers(landmarks, handedness);
  return ext[1] && !ext[2] && !ext[3] && !ext[4];
}

function isPauseGesture(landmarks: Landmark[], handedness: "Left" | "Right"): boolean {
  return getExtendedFingers(landmarks, handedness).filter(Boolean).length >= 3;
}

export default function HandTrackerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLCanvasElement>(null);
  const handsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  const [status, setStatus] = useState<"idle" | "loading" | "active" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [appMode, setAppMode] = useState<AppMode>("track");
  const [fps, setFps] = useState(0);
  const [handCount, setHandCount] = useState(0);
  const [fingersUp, setFingersUp] = useState(0);
  const [drawColor, setDrawColor] = useState(PALETTE[0]);
  const [brushSize, setBrushSize] = useState(BRUSH_SIZES[1]);
  const [isEraser, setIsEraser] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [undoStack, setUndoStack] = useState<ImageData[]>([]);
  const [showVideo, setShowVideo] = useState(true);

  const prevPt = useRef<{ x: number; y: number } | null>(null);
  const drawColorRef = useRef(drawColor);
  const brushRef = useRef(brushSize);
  const eraserRef = useRef(isEraser);
  const appModeRef = useRef(appMode);
  const fpsCounter = useRef({ frames: 0, last: Date.now() });
  const stateUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingState = useRef({ hands: 0, fingers: 0 });
  const isDrawingRef = useRef(false);
  const undoStackRef = useRef<ImageData[]>([]);
  const pendingSave = useRef(false);

  useEffect(() => { drawColorRef.current = drawColor; }, [drawColor]);
  useEffect(() => { brushRef.current = brushSize; }, [brushSize]);
  useEffect(() => { eraserRef.current = isEraser; }, [isEraser]);
  useEffect(() => { appModeRef.current = appMode; }, [appMode]);
  useEffect(() => { undoStackRef.current = undoStack; }, [undoStack]);

  const saveUndo = useCallback(() => {
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const snap = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setUndoStack(prev => [...prev.slice(-29), snap]);
  }, []);

  const undo = useCallback(() => {
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    setUndoStack(prev => {
      if (prev.length === 0) return prev;
      const next = [...prev];
      const last = next.pop()!;
      ctx.putImageData(last, 0, 0);
      return next;
    });
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = drawRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    saveUndo();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [saveUndo]);

  const onResults = useCallback((results: any) => {
    const overlay = overlayRef.current;
    const cursor = cursorRef.current;
    if (!overlay || !cursor) return;

    const w = overlay.width;
    const h = overlay.height;
    const ctx = overlay.getContext("2d")!;
    const curCtx = cursor.getContext("2d")!;

    fpsCounter.current.frames++;
    const now = Date.now();
    if (now - fpsCounter.current.last >= 1000) {
      setFps(fpsCounter.current.frames);
      fpsCounter.current.frames = 0;
      fpsCounter.current.last = now;
    }

    ctx.clearRect(0, 0, w, h);
    curCtx.clearRect(0, 0, w, h);

    let totalHands = 0;
    let totalFingers = 0;
    let drawingThisFrame = false;

    if (results.multiHandLandmarks?.length) {
      results.multiHandLandmarks.forEach((landmarks: Landmark[], idx: number) => {
        const handedness = (results.multiHandedness?.[idx]?.label || "Right") as "Left" | "Right";
        const extended = getExtendedFingers(landmarks, handedness);
        const color = handedness === "Right" ? "#38bdf8" : "#a78bfa";
        drawHandOverlay(ctx, landmarks, w, h, color, extended);
        totalHands++;
        totalFingers += extended.filter(Boolean).length;

        if (appModeRef.current === "draw") {
          const tip = landmarks[8];
          const px = tip.x * w;
          const py = tip.y * h;

          if (isPauseGesture(landmarks, handedness)) {
            prevPt.current = null;
          } else if (isDrawGesture(landmarks, handedness)) {
            drawingThisFrame = true;
            const drawCanvas = drawRef.current!;
            const dCtx = drawCanvas.getContext("2d")!;

            if (pendingSave.current) {
              saveUndo();
              pendingSave.current = false;
            }

            if (prevPt.current) {
              const prev = prevPt.current;
              const dist = Math.hypot(px - prev.x, py - prev.y);
              if (dist < 120) {
                if (eraserRef.current) {
                  dCtx.globalCompositeOperation = "destination-out";
                  dCtx.lineWidth = brushRef.current * 3;
                  dCtx.strokeStyle = "rgba(0,0,0,1)";
                } else {
                  dCtx.globalCompositeOperation = "source-over";
                  dCtx.lineWidth = brushRef.current;
                  dCtx.strokeStyle = drawColorRef.current;
                  dCtx.shadowColor = drawColorRef.current;
                  dCtx.shadowBlur = brushRef.current * 0.6;
                }
                dCtx.lineCap = "round";
                dCtx.lineJoin = "round";
                const mx = (prev.x + px) / 2;
                const my = (prev.y + py) / 2;
                dCtx.beginPath();
                dCtx.moveTo(prev.x, prev.y);
                dCtx.quadraticCurveTo(prev.x, prev.y, mx, my);
                dCtx.stroke();
                dCtx.shadowBlur = 0;
                dCtx.globalCompositeOperation = "source-over";
              }
            } else {
              pendingSave.current = true;
            }
            prevPt.current = { x: px, y: py };

            curCtx.beginPath();
            curCtx.arc(px, py, brushRef.current / 2 + 8, 0, Math.PI * 2);
            curCtx.strokeStyle = eraserRef.current ? "rgba(255,255,255,0.5)" : drawColorRef.current + "cc";
            curCtx.lineWidth = 2;
            curCtx.stroke();
            curCtx.beginPath();
            curCtx.arc(px, py, 3, 0, Math.PI * 2);
            curCtx.fillStyle = eraserRef.current ? "white" : drawColorRef.current;
            curCtx.fill();
          } else {
            prevPt.current = null;
            curCtx.beginPath();
            curCtx.arc(px, py, brushRef.current / 2 + 6, 0, Math.PI * 2);
            curCtx.strokeStyle = "rgba(255,255,255,0.25)";
            curCtx.lineWidth = 1.5;
            curCtx.setLineDash([3, 5]);
            curCtx.stroke();
            curCtx.setLineDash([]);
          }
        }
      });
    } else {
      prevPt.current = null;
    }

    if (drawingThisFrame !== isDrawingRef.current) {
      isDrawingRef.current = drawingThisFrame;
      setIsDrawing(drawingThisFrame);
    }

    pendingState.current = { hands: totalHands, fingers: totalFingers };
    if (!stateUpdateTimer.current) {
      stateUpdateTimer.current = setTimeout(() => {
        setHandCount(pendingState.current.hands);
        setFingersUp(pendingState.current.fingers);
        stateUpdateTimer.current = null;
      }, 100);
    }
  }, [saveUndo]);

  const startTracking = useCallback(async () => {
    if (status === "active") return;
    setStatus("loading");
    setError(null);
    try {
      if (!window.Hands || !window.Camera) {
        await new Promise<void>((resolve, reject) => {
          const srcs = [
            "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/hands.js",
            "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils@0.3.1640029074/camera_utils.js",
          ];
          let done = 0;
          srcs.forEach(src => {
            const s = document.createElement("script");
            s.src = src; s.crossOrigin = "anonymous";
            s.onload = () => { if (++done === srcs.length) resolve(); };
            s.onerror = () => reject(new Error("Failed to load MediaPipe"));
            document.head.appendChild(s);
          });
        });
      }
      await new Promise(r => setTimeout(r, 300));

      const mp = new window.Hands({
        locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1646424915/${f}`,
      });
      mp.setOptions({ maxNumHands: 2, modelComplexity: 0, minDetectionConfidence: 0.6, minTrackingConfidence: 0.5 });
      mp.onResults(onResults);
      await mp.initialize();
      handsRef.current = mp;

      const cam = new window.Camera(videoRef.current!, {
        onFrame: async () => { await handsRef.current?.send({ image: videoRef.current }); },
        width: 1280, height: 720,
      });
      await cam.start();
      cameraRef.current = cam;
      setStatus("active");
    } catch (e: any) {
      setError(e?.message || "Camera access denied");
      setStatus("error");
    }
  }, [status, onResults]);

  const stop = useCallback(() => {
    cameraRef.current?.stop();
    handsRef.current?.close();
    cameraRef.current = null; handsRef.current = null;
    setStatus("idle"); setHandCount(0); setFingersUp(0);
    prevPt.current = null;
    overlayRef.current?.getContext("2d")?.clearRect(0, 0, 1280, 720);
    cursorRef.current?.getContext("2d")?.clearRect(0, 0, 1280, 720);
  }, []);

  useEffect(() => { if (handsRef.current) handsRef.current.onResults(onResults); }, [onResults]);
  useEffect(() => () => { stop(); }, []);

  const canvasStyle = { transform: "scaleX(-1)" } as const;

  return (
    <div className="h-screen w-screen overflow-hidden bg-black flex flex-col relative">
      <video ref={videoRef} autoPlay playsInline muted
        className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${showVideo && status === "active" ? "opacity-60" : "opacity-0"}`}
        style={canvasStyle}
      />
      <canvas ref={drawRef} width={1280} height={720}
        className="absolute inset-0 w-full h-full object-cover"
        style={canvasStyle}
      />
      <canvas ref={overlayRef} width={1280} height={720}
        className="absolute inset-0 w-full h-full object-cover"
        style={canvasStyle}
      />
      <canvas ref={cursorRef} width={1280} height={720}
        className="absolute inset-0 w-full h-full object-cover"
        style={canvasStyle}
      />

      {status === "idle" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <div className="text-center px-8 max-w-md">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm flex items-center justify-center">
              <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8">
                <path d="M18 11V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M14 10V4a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v0" /><path d="M10 10.5V6a2 2 0 0 0-2-2v0a2 2 0 0 0-2 2v3" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-white mb-3">Hand Tracker</h1>
            <p className="text-white/50 text-sm mb-8 leading-relaxed">Track your hands or paint in the air with your fingers</p>
            <button onClick={startTracking}
              className="bg-white text-black font-semibold px-8 py-3 rounded-full hover:bg-white/90 transition-all text-sm">
              Start Camera
            </button>
          </div>
        </div>
      )}

      {status === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin mb-4" />
          <p className="text-white/60 text-sm">Loading hand tracking model...</p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-10">
          <p className="text-white/40 text-sm mb-4">{error}</p>
          <button onClick={startTracking} className="bg-white text-black font-semibold px-6 py-2.5 rounded-full text-sm">Retry</button>
        </div>
      )}

      {status === "active" && (
        <>
          <div className="absolute top-4 left-4 right-4 flex items-start justify-between z-10 pointer-events-none">
            <div className="flex items-center gap-2 pointer-events-auto">
              <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5">
                <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                <span className="text-white/70 text-xs font-mono">{fps} fps</span>
              </div>
              <div className="bg-black/40 backdrop-blur-md border border-white/10 rounded-full px-3 py-1.5">
                <span className="text-white/70 text-xs">{handCount} hand{handCount !== 1 ? "s" : ""} · {fingersUp} up</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pointer-events-auto">
              {appMode === "draw" && isDrawing && (
                <div className="bg-green-500/20 backdrop-blur-md border border-green-500/30 rounded-full px-3 py-1.5">
                  <span className="text-green-300 text-xs font-medium">Drawing</span>
                </div>
              )}
              <button onClick={stop}
                className="bg-black/40 backdrop-blur-md border border-white/10 text-white/60 hover:text-white rounded-full px-3 py-1.5 text-xs transition-colors">
                Stop
              </button>
            </div>
          </div>

          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-3">
            {appMode === "draw" && (
              <>
                <div className="flex items-center gap-3 bg-black/50 backdrop-blur-xl border border-white/10 rounded-2xl px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    {PALETTE.map(c => (
                      <button key={c} onClick={() => { setDrawColor(c); setIsEraser(false); }}
                        className="rounded-full border-2 transition-all duration-100 hover:scale-110 active:scale-95"
                        style={{
                          width: 22, height: 22,
                          backgroundColor: c,
                          borderColor: drawColor === c && !isEraser ? "white" : "transparent",
                        }}
                      />
                    ))}
                  </div>
                  <div className="w-px h-5 bg-white/15" />
                  <div className="flex items-center gap-1.5">
                    {BRUSH_SIZES.map(s => (
                      <button key={s} onClick={() => setBrushSize(s)}
                        className={`rounded-full flex items-center justify-center w-7 h-7 border transition-all duration-100 ${brushSize === s ? "border-white/40 bg-white/10" : "border-transparent hover:border-white/20"}`}>
                        <div className="rounded-full bg-white" style={{ width: Math.min(s * 0.5 + 2, 16), height: Math.min(s * 0.5 + 2, 16) }} />
                      </button>
                    ))}
                  </div>
                  <div className="w-px h-5 bg-white/15" />
                  <button onClick={() => setIsEraser(e => !e)}
                    className={`rounded-lg px-2.5 py-1 text-xs font-medium transition-all duration-100 ${isEraser ? "bg-white/20 text-white" : "text-white/40 hover:text-white/70"}`}>
                    Eraser
                  </button>
                  <div className="w-px h-5 bg-white/15" />
                  <button onClick={undo} disabled={undoStack.length === 0}
                    className="text-white/40 hover:text-white/70 disabled:opacity-20 text-xs transition-colors px-1">
                    Undo
                  </button>
                  <button onClick={clearCanvas}
                    className="text-white/40 hover:text-white/70 text-xs transition-colors px-1">
                    Clear
                  </button>
                </div>

                <div className="bg-black/30 backdrop-blur-md border border-white/8 rounded-full px-4 py-1.5">
                  <p className="text-white/35 text-xs">☝ one finger draws &nbsp;·&nbsp; ✋ three+ fingers pause</p>
                </div>
              </>
            )}

            <div className="flex items-center gap-1 bg-black/50 backdrop-blur-xl border border-white/10 rounded-full p-1">
              {(["track", "draw"] as AppMode[]).map(m => (
                <button key={m} onClick={() => { setAppMode(m); prevPt.current = null; }}
                  className={`px-5 py-1.5 rounded-full text-xs font-semibold transition-all duration-200 capitalize ${appMode === m ? "bg-white text-black" : "text-white/50 hover:text-white/80"}`}>
                  {m === "track" ? "Track" : "Draw"}
                </button>
              ))}
              <div className="w-px h-4 bg-white/15 mx-1" />
              <button onClick={() => setShowVideo(v => !v)}
                className="px-3 py-1.5 text-xs text-white/40 hover:text-white/70 transition-colors rounded-full">
                {showVideo ? "Hide" : "Show"} cam
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
