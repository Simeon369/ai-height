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
  BASKETBALL_DIAMETER_CM,
} from '@/lib/measurements';
import {
  Loader2,
  CircleDot,
  Ruler,
  MoveHorizontal,
  ArrowUpFromLine,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  SwitchCamera,
} from 'lucide-react';
import { validateMeasurements } from '@/lib/measurements';

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

const PHASE_INFO: Record<FlowPhase, { title: string; instruction: string }> = {
  detecting_ball: {
    title: 'Finding basketball',
    instruction: 'Place a Size 7 basketball on the floor where you will stand, then point the camera at it.',
  },
  calibrating: {
    title: 'Calibrating',
    instruction: 'Basketball detected. Hold steady — locking in the scale reference.',
  },
  measuring_height: {
    title: 'Measuring height',
    instruction: 'Stand straight next to the basketball with arms at your sides. Full body must be in frame.',
  },
  measuring_wingspan: {
    title: 'Measuring wingspan',
    instruction: 'Extend both arms fully to the sides at shoulder height.',
  },
  measuring_reach: {
    title: 'Standing reach',
    instruction: 'Raise one arm straight up as high as you can.',
  },
  complete: {
    title: 'Complete',
    instruction: 'Measurement captured.',
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
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [phase, setPhase] = useState<FlowPhase>('detecting_ball');
  const [cmPerPixel, setCmPerPixel] = useState(0);
  const [ballPosition, setBallPosition] = useState<{ x: number; y: number; d: number } | null>(null);
  const [poseType, setPoseType] = useState<string>('unknown');
  const [sampleCount, setSampleCount] = useState(0);
  const [heightResult, setHeightResult] = useState<number | null>(null);
  const [wingspanResult, setWingspanResult] = useState<number | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);

  const stabilizer = useRef(new BallDetectionStabilizer(15));
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
              const finalResults: MeasurementResult = {
                heightCm: avg.heightCm,
                cmPerPixel: Math.round(cmPerPixel * 10000) / 10000,
                ballDiameterPx: cmPerPixel > 0 ? Math.round(BASKETBALL_DIAMETER_CM / cmPerPixel) : 0,
              };

              const validation = validateMeasurements(finalResults);
              if (!validation.valid) {
                setValidationError(validation.reason ?? 'Measurements seem inaccurate.');
                stopDetectionLoop();
              } else {
                stopDetectionLoop();
                onComplete(finalResults);
                setPhase('complete');
              }
            }
          }
        }
      },
    });

  // Start camera (toggleable facing mode with robust constraint fallbacks)
  const startCamera = useCallback(async () => {
    setCameraReady(false);
    setCameraError(null);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (typeof window !== 'undefined' && (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)) {
      setCameraError('Camera access requires a Secure Context (HTTPS or localhost). If testing on a mobile device, please access via HTTPS or use localhost.');
      return;
    }

    // Array of constraint strategies to try in order of preference
    const constraintList: MediaStreamConstraints[] = [
      {
        video: {
          facingMode: { ideal: facingMode },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      },
      {
        video: { facingMode: { ideal: facingMode } },
        audio: false,
      },
      {
        video: true,
        audio: false,
      },
    ];

    let stream: MediaStream | null = null;
    let lastErr: unknown = null;

    for (const constraints of constraintList) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (stream) break;
      } catch (err) {
        lastErr = err;
      }
    }

    if (!stream) {
      console.error('All camera constraint attempts failed:', lastErr);
      const errMsg = lastErr instanceof Error ? lastErr.message : 'Camera access denied or device unavailable.';
      setCameraError(errMsg);
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch((e) => console.error('Play error:', e));
        setCameraReady(true);
      };
    }

    try {
      await initBallDetector();
      setBallDetectorReady(true);
      initialize();
    } catch (err) {
      console.error('Model initialization error:', err);
    }
  }, [facingMode, initialize]);

  useEffect(() => {
    let mounted = true;
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
  }, [facingMode]);

  // Basketball detection loop (runs during detecting_ball and calibrating phases)
  useEffect(() => {
    if (!cameraReady || !ballDetectorReady || !videoRef.current) return;

    let frameId: number;
    let lastDetectionTime = -1;

    const detect = () => {
      if (!videoRef.current) return;
      const currentPhase = phaseRef.current;

      // Only run detection while in detecting_ball or calibrating phase
      if (currentPhase !== 'detecting_ball' && currentPhase !== 'calibrating') {
        return;
      }

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

        if (currentPhase === 'detecting_ball') {
          setPhase('calibrating');
        }

        const stable = stabilizer.current.getStableResult();
        if (stable && (currentPhase === 'detecting_ball' || currentPhase === 'calibrating')) {
          setCmPerPixel(stable.cmPerPixel);
          setPhase('measuring_height');
        }
      } else {
        stabilizer.current.addSample(result);
        if (stabilizer.current.getMissedFrames() > 8) {
          setBallPosition(null);
          if (currentPhase === 'calibrating') {
            setPhase('detecting_ball');
          }
        }
      }

      frameId = requestAnimationFrame(detect);
    };

    detect();

    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [cameraReady, ballDetectorReady]);

  const handleRecalibrate = useCallback(() => {
    setPhase('detecting_ball');
    setCmPerPixel(0);
    setBallPosition(null);
    setHeightResult(null);
    setWingspanResult(null);
    setValidationError(null);
    setSampleCount(0);
    measurementSamples.current = [];
    stabilizer.current.reset();
  }, []);

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

      // Vertical tick-mark ruler along right edge
      const rulerX = canvas.width - 18;
      const numTicks = 10;
      ctx.strokeStyle = 'rgba(242, 238, 228, 0.25)';
      ctx.lineWidth = 1;
      for (let i = 0; i <= numTicks; i++) {
        const y = (canvas.height / numTicks) * i;
        const tickLen = i === 0 || i === numTicks ? 12 : 6;
        ctx.beginPath();
        ctx.moveTo(rulerX, y);
        ctx.lineTo(rulerX + tickLen, y);
        ctx.stroke();
      }
      // Ruler rail line
      ctx.beginPath();
      ctx.moveTo(rulerX, 0);
      ctx.lineTo(rulerX, canvas.height);
      ctx.strokeStyle = 'rgba(242, 238, 228, 0.1)';
      ctx.stroke();

      // Ball detection bounding box
      if (ballPosition && (phase === 'detecting_ball' || phase === 'calibrating')) {
        const isLocked = phase === 'calibrating';
        const color = isLocked ? '#E85D2C' : '#C88B3D';
        const halfD = ballPosition.d / 2;

        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(isLocked ? [] : [6, 6]);
        ctx.strokeRect(
          ballPosition.x - halfD,
          ballPosition.y - halfD,
          ballPosition.d,
          ballPosition.d
        );
        ctx.setLineDash([]);

        // Corner bracket accents
        const cornerLen = Math.min(14, halfD * 0.35);
        ctx.lineWidth = 2;
        const corners = [
          [ballPosition.x - halfD, ballPosition.y - halfD],
          [ballPosition.x + halfD, ballPosition.y - halfD],
          [ballPosition.x - halfD, ballPosition.y + halfD],
          [ballPosition.x + halfD, ballPosition.y + halfD],
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

        // Status label
        ctx.fillStyle = color;
        ctx.font = `500 ${Math.max(12, canvas.width / 45)}px Inter, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillText(
          isLocked ? 'Calibrating' : 'Basketball detected',
          ballPosition.x,
          ballPosition.y - halfD - 10
        );
      }

      // Skeleton during measurement phases
      const landmarks = latestLandmarksRef.current;
      if (landmarks && phase.startsWith('measuring_')) {
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

        const expectedPose =
          phase === 'measuring_height' ? 'standing' :
          phase === 'measuring_wingspan' ? 'arms_out' :
          phase === 'measuring_reach' ? 'arm_up' : null;

        const poseCorrect = expectedPose === poseType;
        // Accent orange when correct, muted grey when waiting
        const lineColor = poseCorrect ? 'rgba(200, 139, 61, 0.9)' : 'rgba(242, 238, 228, 0.35)';
        const pointColor = poseCorrect ? '#C88B3D' : 'rgba(242, 238, 228, 0.5)';

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
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
        for (const lm of landmarks) {
          if ((lm.visibility ?? 0) > 0.3) {
            ctx.fillStyle = pointColor;
            ctx.beginPath();
            ctx.arc(lm.x * canvas.width, lm.y * canvas.height, 3, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }

      frameId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(frameId);
  }, [cameraReady, ballPosition, phase, poseType]);

  const phaseInfo = PHASE_INFO[phase];
  const expectedPose =
    phase === 'measuring_height' ? 'standing' :
    phase === 'measuring_wingspan' ? 'arms_out' :
    phase === 'measuring_reach' ? 'arm_up' : null;
  const poseCorrect = expectedPose ? poseType === expectedPose : false;

  // Dot color: confirm/orange when locked into measuring, amber when scanning
  const isLocked = phase.startsWith('measuring_') || phase === 'complete';
  const dotColor = isLocked ? '#E85D2C' : '#C88B3D';

  return (
    <div className="relative flex flex-col h-full bg-black">
      {/* Video feed */}
      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className={`absolute inset-0 w-full h-full object-cover z-0 ${
            facingMode === 'user' ? '-scale-x-100' : ''
          }`}
          autoPlay
          playsInline
          muted
        />
        <canvas
          ref={overlayCanvasRef}
          className={`absolute inset-0 w-full h-full object-cover pointer-events-none z-10 ${
            facingMode === 'user' ? '-scale-x-100' : ''
          }`}
        />

        {/* Top Controls Bar — camera flip only */}
        <div className="absolute top-4 right-4 z-20 pointer-events-auto">
          <button
            onClick={() =>
              setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))
            }
            className="w-10 h-10 flex items-center justify-center active:opacity-70"
            style={{ color: '#F2EEE4' }}
            title="Switch camera"
          >
            <SwitchCamera className="w-5 h-5" />
          </button>
        </div>

        {/* Pose status — top-left text, no pill/card */}
        {expectedPose && (
          <div className="absolute top-4 left-4 z-10">
            <p
              className="text-xs font-medium"
              style={{ color: poseCorrect ? '#E85D2C' : '#C88B3D' }}
            >
              {poseCorrect ? 'Capturing' : 'Waiting for pose'}
            </p>
          </div>
        )}

        {/* Loading overlay */}
        {((!cameraReady && !cameraError) || (!ballDetectorReady && !cameraError) || (phase.startsWith('measuring_') && !isReady && !error)) && (
          <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: 'rgba(20,17,16,0.85)' }}>
            <div className="flex flex-col items-center gap-3 px-6 text-center">
              <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C88B3D' }} />
              <p className="text-sm" style={{ color: '#8B8478' }}>
                {!cameraReady ? 'Starting camera' :
                 !ballDetectorReady ? 'Loading detection model' :
                 'Setting up AI'}
              </p>
            </div>
          </div>
        )}

        {/* Camera Error Overlay */}
        {cameraError && (
          <div className="absolute inset-0 flex items-end z-30 px-5 pb-8" style={{ background: 'rgba(20,17,16,0.95)' }}>
            <div className="w-full max-w-sm mx-auto">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4" style={{ color: '#E85D2C' }} />
                <h3 className="text-sm font-semibold" style={{ color: '#F2EEE4' }}>Camera unavailable</h3>
              </div>
              <p className="text-sm leading-relaxed mb-5" style={{ color: '#8B8478' }}>{cameraError}</p>
              <div className="flex gap-3">
                <button
                  onClick={onBack}
                  className="flex-1 py-3 text-sm font-medium"
                  style={{ color: '#8B8478' }}
                >
                  Go back
                </button>
                <button
                  onClick={startCamera}
                  className="flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2"
                  style={{ background: '#C88B3D', color: '#141110', borderRadius: '4px' }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Retry
                </button>
              </div>
            </div>
          </div>
        )}

        {(error && !cameraError) && (
          <div className="absolute inset-0 flex items-end z-20 px-5 pb-8" style={{ background: 'rgba(20,17,16,0.9)' }}>
            <div className="w-full">
              <p className="text-sm mb-4" style={{ color: '#8B8478' }}>{error}</p>
              <button
                onClick={onBack}
                className="py-3 px-5 text-sm font-medium"
                style={{ color: '#8B8478' }}
              >
                Go back
              </button>
            </div>
          </div>
        )}

        {/* Validation Error */}
        {validationError && (
          <div className="absolute inset-0 flex items-end z-30 px-5 pb-8" style={{ background: 'rgba(20,17,16,0.95)' }}>
            <div className="w-full max-w-sm mx-auto">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4" style={{ color: '#C88B3D' }} />
                <h3 className="text-sm font-semibold" style={{ color: '#F2EEE4' }}>Inaccurate reading</h3>
              </div>
              <p className="text-sm leading-relaxed mb-5" style={{ color: '#8B8478' }}>{validationError}</p>
              <div className="flex gap-3">
                <button
                  onClick={onBack}
                  className="flex-1 py-3 text-sm font-medium"
                  style={{ color: '#8B8478' }}
                >
                  Cancel
                </button>
                <button
                  onClick={handleRecalibrate}
                  className="flex-1 py-3 text-sm font-semibold flex items-center justify-center gap-2"
                  style={{ background: '#C88B3D', color: '#141110', borderRadius: '4px' }}
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Try again
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom panel — solid dark, accent top border */}
      <div
        className="px-5 pt-4 pb-6 space-y-4"
        style={{ background: '#141110', borderTop: '1px solid #C88B3D' }}
      >
        {/* Phase status row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ background: dotColor }}
            />
            <span className="text-sm font-medium" style={{ color: '#F2EEE4' }}>
              {phaseInfo.title}
            </span>
          </div>
          {/* Camera flip moved here on smaller row */}
        </div>

        {/* Instruction */}
        <p className="text-sm leading-snug" style={{ color: '#8B8478' }}>
          {phaseInfo.instruction}
        </p>

        {/* Segmented progress — 1 segment for height */}
        {phase.startsWith('measuring_') && (
          <div className="space-y-2">
            <div className="flex gap-1.5">
              {/* Height segment */}
              <div className="flex-1 h-1 overflow-hidden" style={{ background: '#2A2521' }}>
                <div
                  className="h-full transition-all duration-200"
                  style={{
                    width: `${(sampleCount / SAMPLES_NEEDED) * 100}%`,
                    background: poseCorrect ? '#C88B3D' : '#2A2521',
                  }}
                />
              </div>
            </div>
            <p className="text-xs" style={{ color: '#8B8478' }}>
              {poseCorrect
                ? `Capturing — ${sampleCount} / ${SAMPLES_NEEDED}`
                : 'Waiting for correct pose'}
            </p>
          </div>
        )}

        {/* Calibration info — inline, no card */}
        {cmPerPixel > 0 && (
          <div
            className="flex items-center justify-between pt-1"
            style={{ borderTop: '1px solid #2A2521' }}
          >
            <span className="text-xs" style={{ color: '#8B8478' }}>Ball reference</span>
            <span className="font-tabular text-xs" style={{ color: '#8B8478' }}>
              {ballPosition ? Math.round(ballPosition.d) : Math.round(24.1 / cmPerPixel)} px
              &nbsp;·&nbsp;{cmPerPixel.toFixed(4)} cm/px
            </span>
          </div>
        )}

        {/* Cancel */}
        <button
          id="cancel-measure-btn"
          onClick={onBack}
          className="w-full py-3 text-sm font-medium transition-opacity active:opacity-70"
          style={{ color: '#8B8478' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
