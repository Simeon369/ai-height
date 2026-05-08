'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { usePoseDetection } from '@/hooks/usePoseDetection';
import { initBallDetector, detectBasketball, closeBallDetector, BallDetectionStabilizer } from '@/lib/basketballDetector';
import {
  computeMeasurements,
  averageMeasurements,
  type NormalizedLandmark,
  type MeasurementResult,
  LANDMARKS,
} from '@/lib/measurements';
import {
  Loader2,
  CircleDot,
  Ruler,
  MoveHorizontal,
  ArrowUpFromLine,
  CheckCircle2,
} from 'lucide-react';

/**
 * Flow phases — all happen in a single continuous camera session:
 * 1. detecting_ball  — Scanning for basketball automatically
 * 2. calibrating     — Basketball found, stabilizing readings
 * 3. measuring_height — User stands straight, arms at sides
 * 4. measuring_wingspan — User extends arms horizontally
 * 5. measuring_reach  — User raises one arm up
 * 6. complete         — All measurements captured
 */
type FlowPhase =
  | 'detecting_ball'
  | 'calibrating'
  | 'measuring_height'
  | 'measuring_wingspan'
  | 'measuring_reach'
  | 'complete';

const PHASE_UI: Record<
  FlowPhase,
  { title: string; instruction: string; icon: React.ReactNode }
> = {
  detecting_ball: {
    title: 'Finding Basketball',
    instruction: 'Point the camera at a basketball (or water bottle for testing)',
    icon: <CircleDot className="w-5 h-5" />,
  },
  calibrating: {
    title: 'Calibrating',
    instruction: 'Basketball detected! Hold the camera steady...',
    icon: <Loader2 className="w-5 h-5 animate-spin" />,
  },
  measuring_height: {
    title: 'Measuring Height',
    instruction: 'Stand straight with arms at your sides',
    icon: <Ruler className="w-5 h-5" />,
  },
  measuring_wingspan: {
    title: 'Measuring Wingspan',
    instruction: 'Extend both arms fully to the sides',
    icon: <MoveHorizontal className="w-5 h-5" />,
  },
  measuring_reach: {
    title: 'Standing Reach',
    instruction: 'Raise one arm straight up as high as possible',
    icon: <ArrowUpFromLine className="w-5 h-5" />,
  },
  complete: {
    title: 'Complete!',
    instruction: 'All measurements captured',
    icon: <CheckCircle2 className="w-5 h-5" />,
  },
};

const SAMPLES_NEEDED = 20;

interface MeasureFlowProps {
  onComplete: (results: MeasurementResult) => void;
  onBack: () => void;
}

/**
 * Detect if the user is in the right pose for the current phase.
 */
function detectPoseType(
  landmarks: NormalizedLandmark[]
): 'standing' | 'arms_out' | 'arm_up' | 'unknown' {
  const leftWrist = landmarks[LANDMARKS.LEFT_WRIST];
  const rightWrist = landmarks[LANDMARKS.RIGHT_WRIST];
  const leftShoulder = landmarks[LANDMARKS.LEFT_SHOULDER];
  const rightShoulder = landmarks[LANDMARKS.RIGHT_SHOULDER];
  const leftHip = landmarks[LANDMARKS.LEFT_HIP];
  const rightHip = landmarks[LANDMARKS.RIGHT_HIP];
  const nose = landmarks[LANDMARKS.NOSE];

  if (
    !leftWrist || !rightWrist || !leftShoulder || !rightShoulder ||
    !leftHip || !rightHip || !nose
  ) {
    return 'unknown';
  }

  // Check visibility
  const allVisible = [leftWrist, rightWrist, leftShoulder, rightShoulder, leftHip, rightHip, nose]
    .every((lm) => (lm.visibility ?? 0) > 0.3);
  if (!allVisible) return 'unknown';

  // Arm up: either wrist is significantly above the nose
  const armUpThreshold = 0.1; // normalized Y distance
  if (leftWrist.y < nose.y - armUpThreshold || rightWrist.y < nose.y - armUpThreshold) {
    return 'arm_up';
  }

  // Arms out: both wrists are far apart horizontally AND near shoulder height
  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const wristSpan = Math.abs(leftWrist.x - rightWrist.x);
  const leftWristNearShoulderHeight = Math.abs(leftWrist.y - leftShoulder.y) < 0.12;
  const rightWristNearShoulderHeight = Math.abs(rightWrist.y - rightShoulder.y) < 0.12;

  if (
    wristSpan > shoulderWidth * 2.0 &&
    leftWristNearShoulderHeight &&
    rightWristNearShoulderHeight
  ) {
    return 'arms_out';
  }

  // Standing: wrists near hips
  const leftWristNearHip = Math.abs(leftWrist.y - leftHip.y) < 0.15;
  const rightWristNearHip = Math.abs(rightWrist.y - rightHip.y) < 0.15;
  const wristsClose = wristSpan < shoulderWidth * 2.0;

  if (leftWristNearHip && rightWristNearHip && wristsClose) {
    return 'standing';
  }

  return 'unknown';
}

export default function MeasureFlow({ onComplete, onBack }: MeasureFlowProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ballDetectorReady, setBallDetectorReady] = useState(false);

  const [cameraReady, setCameraReady] = useState(false);
  const [phase, setPhase] = useState<FlowPhase>('detecting_ball');
  const [cmPerPixel, setCmPerPixel] = useState(0);
  const [ballPosition, setBallPosition] = useState<{ x: number; y: number; d: number } | null>(null);
  const [poseType, setPoseType] = useState<string>('unknown');
  const [sampleCount, setSampleCount] = useState(0);
  const [heightResult, setHeightResult] = useState<number | null>(null);
  const [wingspanResult, setWingspanResult] = useState<number | null>(null);

  const stabilizer = useRef(new BallDetectionStabilizer(12));
  const measurementSamples = useRef<MeasurementResult[]>([]);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const phaseRef = useRef(phase);

  // Keep ref in sync
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Pose detection hook
  const { initialize, isLoading, isReady, error, startDetectionLoop, stopDetectionLoop, cleanup } =
    usePoseDetection({
      onResults: (landmarks) => {
        latestLandmarksRef.current = landmarks;
        const pose = detectPoseType(landmarks);
        setPoseType(pose);

        if (!videoRef.current || cmPerPixel <= 0) return;
        const w = videoRef.current.videoWidth;
        const h = videoRef.current.videoHeight;
        const currentPhase = phaseRef.current;

        // Only collect samples when the pose matches the current phase
        const expectedPose =
          currentPhase === 'measuring_height' ? 'standing' :
          currentPhase === 'measuring_wingspan' ? 'arms_out' :
          currentPhase === 'measuring_reach' ? 'arm_up' : null;

        if (expectedPose && pose === expectedPose) {
          const measurement = computeMeasurements(landmarks, cmPerPixel, w, h);
          measurementSamples.current.push(measurement);
          setSampleCount(measurementSamples.current.length);

          if (measurementSamples.current.length >= SAMPLES_NEEDED) {
            const avg = averageMeasurements(measurementSamples.current);
            measurementSamples.current = [];
            setSampleCount(0);

            if (currentPhase === 'measuring_height') {
              setHeightResult(avg.heightCm);
              setPhase('measuring_wingspan');
            } else if (currentPhase === 'measuring_wingspan') {
              setWingspanResult(avg.wingspanCm);
              setPhase('measuring_reach');
            } else if (currentPhase === 'measuring_reach') {
              stopDetectionLoop();
              onComplete({
                heightCm: heightResult ?? avg.heightCm,
                wingspanCm: wingspanResult ?? avg.wingspanCm,
                standingReachCm: avg.standingReachCm,
              });
              setPhase('complete');
            }
          }
        }
      },
    });

  // Start camera (back-facing)
  useEffect(() => {
    let mounted = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
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

        // Initialize both models in parallel
        await Promise.all([
          initialize(),
          initBallDetector().then(() => setBallDetectorReady(true)),
        ]);
      } catch (err) {
        console.error('Camera setup failed:', err);
      }
    }

    startCamera();

    return () => {
      mounted = false;
      stopDetectionLoop();
      cleanup();
      closeBallDetector();
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Basketball detection loop (runs during detecting_ball and calibrating phases)
  useEffect(() => {
    if (!cameraReady || !ballDetectorReady || !videoRef.current) return;
    if (phase !== 'detecting_ball' && phase !== 'calibrating') return;

    let frameId: number;
    let lastDetectionTime = -1;

    const detect = () => {
      if (!videoRef.current) return;

      const now = performance.now();
      // MediaPipe requires strictly increasing timestamps
      if (now <= lastDetectionTime) {
        frameId = requestAnimationFrame(detect);
        return;
      }
      lastDetectionTime = now;

      const result = detectBasketball(videoRef.current, now);

      if (result.found) {
        setBallPosition({ x: result.centerX, y: result.centerY, d: result.diameterPx });
        stabilizer.current.addSample(result);

        if (phase === 'detecting_ball') {
          setPhase('calibrating');
        }

        const stable = stabilizer.current.getStableResult();
        if (stable && phase === 'calibrating') {
          setCmPerPixel(stable.cmPerPixel);
          setPhase('measuring_height');
        }
      } else {
        setBallPosition(null);
        if (phase === 'calibrating') {
          // Lost the ball — go back to detecting
          stabilizer.current.reset();
          setPhase('detecting_ball');
        }
      }

      frameId = requestAnimationFrame(detect);
    };

    detect();

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [cameraReady, ballDetectorReady, phase]);

  // Start pose detection once calibrated
  useEffect(() => {
    if (
      phase === 'measuring_height' &&
      isReady &&
      cameraReady &&
      videoRef.current
    ) {
      startDetectionLoop(videoRef.current);
    }
  }, [phase, isReady, cameraReady, startDetectionLoop]);

  // Draw overlay (skeleton + ball indicator)
  useEffect(() => {
    if (!cameraReady || !overlayCanvasRef.current || !videoRef.current) return;

    const canvas = overlayCanvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const draw = () => {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw ball detection indicator (bounding box from ML detector)
      if (ballPosition && (phase === 'detecting_ball' || phase === 'calibrating')) {
        const color = phase === 'calibrating' ? '#22c55e' : '#f59e0b';
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.setLineDash(phase === 'calibrating' ? [] : [8, 8]);

        // Draw bounding box
        const halfD = ballPosition.d / 2;
        ctx.strokeRect(
          ballPosition.x - halfD,
          ballPosition.y - halfD,
          ballPosition.d,
          ballPosition.d
        );
        ctx.setLineDash([]);

        // Corner accents for premium feel
        const cornerLen = Math.min(20, halfD * 0.4);
        ctx.lineWidth = 4;
        ctx.strokeStyle = color;
        const corners = [
          [ballPosition.x - halfD, ballPosition.y - halfD], // top-left
          [ballPosition.x + halfD, ballPosition.y - halfD], // top-right
          [ballPosition.x - halfD, ballPosition.y + halfD], // bottom-left
          [ballPosition.x + halfD, ballPosition.y + halfD], // bottom-right
        ];
        for (const [cx, cy] of corners) {
          const dirX = cx < ballPosition.x ? 1 : -1;
          const dirY = cy < ballPosition.y ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(cx + dirX * cornerLen, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + dirY * cornerLen);
          ctx.stroke();
        }

        // Label
        ctx.fillStyle = color;
        ctx.font = `bold ${Math.max(14, canvas.width / 40)}px Inter, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(
          phase === 'calibrating' ? '🏀 Calibrating...' : '🏀 Basketball Detected',
          ballPosition.x,
          ballPosition.y - halfD - 14
        );
      }

      // Draw skeleton during measurement phases
      const landmarks = latestLandmarksRef.current;
      if (landmarks && phase.startsWith('measuring_')) {
        // Connections
        const connections: [number, number][] = [
          [LANDMARKS.LEFT_SHOULDER, LANDMARKS.RIGHT_SHOULDER],
          [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW],
          [LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST],
          [LANDMARKS.LEFT_WRIST, LANDMARKS.LEFT_INDEX],
          [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW],
          [LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST],
          [LANDMARKS.RIGHT_WRIST, LANDMARKS.RIGHT_INDEX],
          [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
          [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
          [LANDMARKS.LEFT_HIP, LANDMARKS.RIGHT_HIP],
          [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE],
          [LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE],
          [LANDMARKS.LEFT_ANKLE, LANDMARKS.LEFT_HEEL],
          [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE],
          [LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE],
          [LANDMARKS.RIGHT_ANKLE, LANDMARKS.RIGHT_HEEL],
        ];

        // Color based on whether pose matches
        const expectedPose =
          phase === 'measuring_height' ? 'standing' :
          phase === 'measuring_wingspan' ? 'arms_out' :
          phase === 'measuring_reach' ? 'arm_up' : null;

        const poseCorrect = expectedPose === poseType;
        const lineColor = poseCorrect ? 'rgba(34, 197, 94, 0.8)' : 'rgba(59, 130, 246, 0.6)';
        const pointColor = poseCorrect ? 'rgba(34, 197, 94, 1)' : 'rgba(255, 255, 255, 0.8)';

        ctx.strokeStyle = lineColor;
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

        // Keypoints
        for (const lm of landmarks) {
          if ((lm.visibility ?? 0) > 0.3) {
            ctx.fillStyle = pointColor;
            ctx.beginPath();
            ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 4, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(frameId);
  }, [cameraReady, ballPosition, phase, poseType]);

  const ui = PHASE_UI[phase];
  const expectedPose =
    phase === 'measuring_height' ? 'standing' :
    phase === 'measuring_wingspan' ? 'arms_out' :
    phase === 'measuring_reach' ? 'arm_up' : null;
  const poseCorrect = expectedPose ? poseType === expectedPose : false;

  // Completed measurements so far
  const completedSteps = [
    heightResult !== null,
    wingspanResult !== null,
    phase === 'complete',
  ];

  return (
    <div className="relative flex flex-col h-full bg-black">
      {/* Video feed */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          playsInline
          muted
        />
        <canvas
          ref={overlayCanvasRef}
          className="absolute inset-0 w-full h-full object-cover pointer-events-none"
        />


        {/* Phase badge - top center */}
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-10">
          <div className="flex items-center gap-2 px-4 py-2.5 rounded-full bg-black/60 backdrop-blur-md border border-white/10">
            {ui.icon}
            <span className="text-white text-sm font-semibold">{ui.title}</span>
          </div>
        </div>

        {/* Pose status indicator */}
        {expectedPose && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10">
            <div
              className={`px-3 py-1.5 rounded-lg backdrop-blur-sm text-xs font-medium transition-colors ${
                poseCorrect
                  ? 'bg-green-600/80 text-white'
                  : 'bg-amber-600/80 text-white'
              }`}
            >
              {poseCorrect ? '✓ Pose detected — capturing...' : 'Waiting for correct pose...'}
            </div>
          </div>
        )}

        {/* Loading overlay */}
        {(isLoading || !cameraReady || !ballDetectorReady) && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/80 z-20">
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
              <p className="text-zinc-300 text-sm">
                {!cameraReady ? 'Starting camera...' : 'Loading AI models...'}
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
      <div className="bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800 px-4 py-4 space-y-3">
        {/* Instruction */}
        <p className="text-white text-center text-sm font-medium">{ui.instruction}</p>

        {/* Progress bar for current measurement */}
        {phase.startsWith('measuring_') && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-zinc-400">
              <span>{poseCorrect ? 'Capturing...' : 'Waiting for pose...'}</span>
              <span>{sampleCount}/{SAMPLES_NEEDED}</span>
            </div>
            <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-200 ${
                  poseCorrect
                    ? 'bg-gradient-to-r from-green-600 to-green-400'
                    : 'bg-gradient-to-r from-blue-600 to-blue-400'
                }`}
                style={{ width: `${(sampleCount / SAMPLES_NEEDED) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-4">
          {[
            { label: 'Height', done: completedSteps[0], active: phase === 'measuring_height' },
            { label: 'Wingspan', done: completedSteps[1], active: phase === 'measuring_wingspan' },
            { label: 'Reach', done: completedSteps[2], active: phase === 'measuring_reach' },
          ].map((step) => (
            <div key={step.label} className="flex items-center gap-1.5">
              <div
                className={`w-2.5 h-2.5 rounded-full transition-all ${
                  step.done
                    ? 'bg-green-500'
                    : step.active
                    ? 'bg-blue-500 ring-2 ring-blue-500/30'
                    : 'bg-zinc-700'
                }`}
              />
              <span
                className={`text-xs ${
                  step.active ? 'text-white font-medium' : step.done ? 'text-green-400' : 'text-zinc-500'
                }`}
              >
                {step.label}
                {step.done && ' ✓'}
              </span>
            </div>
          ))}
        </div>

        {/* Completed measurements preview */}
        {(heightResult !== null || wingspanResult !== null) && (
          <div className="flex gap-2">
            {heightResult !== null && (
              <div className="flex-1 px-3 py-2 rounded-xl bg-zinc-800/80 border border-zinc-700/50">
                <p className="text-zinc-400 text-[10px] uppercase tracking-wider">Height</p>
                <p className="text-white text-sm font-bold">{heightResult} cm</p>
              </div>
            )}
            {wingspanResult !== null && (
              <div className="flex-1 px-3 py-2 rounded-xl bg-zinc-800/80 border border-zinc-700/50">
                <p className="text-zinc-400 text-[10px] uppercase tracking-wider">Wingspan</p>
                <p className="text-white text-sm font-bold">{wingspanResult} cm</p>
              </div>
            )}
          </div>
        )}

        {/* Cancel button */}
        <button
          onClick={onBack}
          className="w-full py-2.5 rounded-xl bg-zinc-800 text-zinc-400 text-xs font-medium transition-colors hover:bg-zinc-700 active:bg-zinc-600"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
