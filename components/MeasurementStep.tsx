'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { usePoseDetection } from '@/hooks/usePoseDetection';
import {
  computeMeasurements,
  averageMeasurements,
  type NormalizedLandmark,
  type MeasurementResult,
  LANDMARKS,
} from '@/lib/measurements';
import { User, MoveHorizontal, ArrowUpFromLine, Loader2 } from 'lucide-react';

type MeasurePhase = 'height' | 'wingspan' | 'reach';

const PHASE_CONFIG: Record<
  MeasurePhase,
  {
    title: string;
    instruction: string;
    icon: React.ReactNode;
    requiredSamples: number;
  }
> = {
  height: {
    title: 'Height',
    instruction: 'Stand straight with arms at your sides, facing the camera',
    icon: <User className="w-6 h-6" />,
    requiredSamples: 15,
  },
  wingspan: {
    title: 'Wingspan',
    instruction: 'Extend both arms fully to the sides, palms forward',
    icon: <MoveHorizontal className="w-6 h-6" />,
    requiredSamples: 15,
  },
  reach: {
    title: 'Standing Reach',
    instruction: 'Raise one arm straight up as high as possible',
    icon: <ArrowUpFromLine className="w-6 h-6" />,
    requiredSamples: 15,
  },
};

interface MeasurementStepProps {
  cmPerPixel: number;
  onComplete: (results: MeasurementResult) => void;
  onBack: () => void;
}

export default function MeasurementStep({
  cmPerPixel,
  onComplete,
  onBack,
}: MeasurementStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhase] = useState<MeasurePhase>('height');
  const [samples, setSamples] = useState<MeasurementResult[]>([]);
  const [currentReading, setCurrentReading] = useState<MeasurementResult | null>(null);
  const [heightResult, setHeightResult] = useState<number | null>(null);
  const [wingspanResult, setWingspanResult] = useState<number | null>(null);
  const [poseDetected, setPoseDetected] = useState(false);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);

  const { initialize, isLoading, isReady, error, startDetectionLoop, stopDetectionLoop, cleanup } =
    usePoseDetection({
      onResults: (landmarks) => {
        latestLandmarksRef.current = landmarks;
        setPoseDetected(true);

        if (!videoRef.current) return;
        const w = videoRef.current.videoWidth;
        const h = videoRef.current.videoHeight;

        const measurement = computeMeasurements(landmarks, cmPerPixel, w, h);
        setCurrentReading(measurement);

        // Auto-collect samples
        setSamples((prev) => {
          const next = [...prev, measurement];
          const config = PHASE_CONFIG[phase];

          if (next.length >= config.requiredSamples) {
            // Phase complete — compute average and move on
            const avg = averageMeasurements(next);

            if (phase === 'height') {
              setHeightResult(avg.heightCm);
              setPhase('wingspan');
              return [];
            } else if (phase === 'wingspan') {
              setWingspanResult(avg.wingspanCm);
              setPhase('reach');
              return [];
            } else {
              // All done
              onComplete({
                heightCm: heightResult ?? avg.heightCm,
                wingspanCm: wingspanResult ?? avg.wingspanCm,
                standingReachCm: avg.standingReachCm,
              });
              return [];
            }
          }

          return next;
        });
      },
    });

  // Start camera and model
  useEffect(() => {
    let mounted = true;

    async function setup() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'user', // Front camera for self-measurement
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });

        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            setCameraReady(true);
          };
        }

        await initialize();
      } catch (err) {
        console.error('Setup failed:', err);
      }
    }

    setup();

    return () => {
      mounted = false;
      stopDetectionLoop();
      cleanup();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start detection loop when ready
  useEffect(() => {
    if (cameraReady && isReady && videoRef.current) {
      startDetectionLoop(videoRef.current);
    }
  }, [cameraReady, isReady, startDetectionLoop]);

  // Draw skeleton overlay
  useEffect(() => {
    if (!cameraReady || !canvasRef.current || !videoRef.current) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const drawSkeleton = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const landmarks = latestLandmarksRef.current;
      if (landmarks) {
        // Draw connections
        const connections: [number, number][] = [
          [LANDMARKS.LEFT_SHOULDER, LANDMARKS.RIGHT_SHOULDER],
          [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW],
          [LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST],
          [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW],
          [LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST],
          [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
          [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
          [LANDMARKS.LEFT_HIP, LANDMARKS.RIGHT_HIP],
          [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE],
          [LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE],
          [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE],
          [LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE],
          [LANDMARKS.LEFT_WRIST, LANDMARKS.LEFT_INDEX],
          [LANDMARKS.RIGHT_WRIST, LANDMARKS.RIGHT_INDEX],
        ];

        ctx.strokeStyle = 'rgba(59, 130, 246, 0.7)';
        ctx.lineWidth = 3;
        for (const [a, b] of connections) {
          const la = landmarks[a];
          const lb = landmarks[b];
          if ((la.visibility ?? 0) > 0.3 && (lb.visibility ?? 0) > 0.3) {
            ctx.beginPath();
            ctx.moveTo(la.x * canvas.width, la.y * canvas.height);
            ctx.lineTo(lb.x * canvas.width, lb.y * canvas.height);
            ctx.stroke();
          }
        }

        // Draw keypoints
        for (const lm of landmarks) {
          if ((lm.visibility ?? 0) > 0.3) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.beginPath();
            ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      frameId = requestAnimationFrame(drawSkeleton);
    };

    drawSkeleton();

    return () => cancelAnimationFrame(frameId);
  }, [cameraReady]);

  const config = PHASE_CONFIG[phase];
  const progress = Math.min(
    (samples.length / config.requiredSamples) * 100,
    100
  );

  return (
    <div className="relative flex flex-col h-full bg-black">
      {/* Video feed */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
          autoPlay
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover -scale-x-100"
        />

        {/* Phase badge */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
            {config.icon}
            <span className="text-white text-sm font-semibold">{config.title}</span>
          </div>
        </div>

        {/* Live reading */}
        {currentReading && poseDetected && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10">
            <div className="px-3 py-1.5 rounded-lg bg-blue-600/80 backdrop-blur-sm">
              <span className="text-white text-xs font-mono">
                {phase === 'height' && `${currentReading.heightCm} cm`}
                {phase === 'wingspan' && `${currentReading.wingspanCm} cm`}
                {phase === 'reach' && `${currentReading.standingReachCm} cm`}
              </span>
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {(isLoading || !cameraReady) && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-zinc-300 text-sm">
                {isLoading ? 'Loading AI model...' : 'Starting camera...'}
              </p>
            </div>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 z-20">
            <div className="text-center px-6">
              <p className="text-red-400 text-sm mb-3">{error}</p>
              <button
                onClick={onBack}
                className="px-4 py-2 rounded-lg bg-zinc-800 text-white text-sm"
              >
                Go Back
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div className="bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800 px-4 py-5 space-y-4">
        {/* Instruction */}
        <p className="text-white text-center text-sm font-medium">
          {config.instruction}
        </p>

        {/* Progress bar */}
        <div className="space-y-1.5">
          <div className="flex justify-between text-xs text-zinc-400">
            <span>Capturing...</span>
            <span>{samples.length}/{config.requiredSamples} frames</span>
          </div>
          <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-600 to-blue-400 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        {/* Phase indicators */}
        <div className="flex items-center justify-center gap-6">
          {(['height', 'wingspan', 'reach'] as MeasurePhase[]).map((p, i) => (
            <div key={p} className="flex items-center gap-2">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-colors ${
                  p === phase
                    ? 'bg-blue-500 ring-2 ring-blue-500/30'
                    : (phase === 'wingspan' && p === 'height') ||
                      (phase === 'reach' && (p === 'height' || p === 'wingspan'))
                    ? 'bg-green-500'
                    : 'bg-zinc-600'
                }`}
              />
              <span
                className={`text-xs ${
                  p === phase ? 'text-white font-medium' : 'text-zinc-500'
                }`}
              >
                {PHASE_CONFIG[p].title}
              </span>
            </div>
          ))}
        </div>

        {/* Back button */}
        <button
          onClick={onBack}
          className="w-full py-2.5 rounded-xl bg-zinc-800 text-zinc-400 text-xs font-medium transition-colors hover:bg-zinc-700"
        >
          Cancel & Start Over
        </button>
      </div>
    </div>
  );
}
