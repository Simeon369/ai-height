'use client';

import React, { useRef, useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePoseDetection } from '@/hooks/usePoseDetection';
import { initBallDetector, detectBasketball, closeBallDetector, BallDetectionStabilizer } from '@/lib/basketballDetector';
import {
  computeMeasurements,
  averageMeasurements,
  REFERENCE_OBJECTS,
  type NormalizedLandmark,
  type MeasurementResult,
  type ReferenceObject,
  LANDMARKS,
} from '@/lib/measurements';
import {
  Loader2,
  AlertTriangle,
  RefreshCw,
  SwitchCamera,
} from 'lucide-react';
import { validateMeasurements } from '@/lib/measurements';
import ManualCalibrationUI from './ManualCalibrationUI';

type FlowPhase =
  | 'detecting_ball'
  | 'calibrating'
  | 'measuring_height'
  | 'manual_calibration'
  | 'measuring_wingspan'
  | 'measuring_reach'
  | 'complete';

const PHASE_INFO: Record<FlowPhase, { title: string; instruction: string }> = {
  detecting_ball: {
    title: 'Finding reference object',
    instruction: 'Place the object on the floor where you will stand, then point the camera at it.',
  },
  calibrating: {
    title: 'Calibrating',
    instruction: 'Object detected. Hold steady — locking in the scale reference.',
  },
  measuring_height: {
    title: 'Measuring height',
    instruction: 'Stand straight. Full body must be in frame.',
  },
  manual_calibration: {
    title: 'Manual Calibration',
    instruction: 'Align the corners to your ATM card.',
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

function detectPoseType(landmarks: NormalizedLandmark[]): 'standing' | 'arms_out' | 'arm_up' | 'unknown' {
  const leftWrist = landmarks[LANDMARKS.LEFT_WRIST];
  const rightWrist = landmarks[LANDMARKS.RIGHT_WRIST];
  const leftShoulder = landmarks[LANDMARKS.LEFT_SHOULDER];
  const rightShoulder = landmarks[LANDMARKS.RIGHT_SHOULDER];
  const leftHip = landmarks[LANDMARKS.LEFT_HIP];
  const rightHip = landmarks[LANDMARKS.RIGHT_HIP];
  const nose = landmarks[LANDMARKS.NOSE];

  if (!leftWrist || !rightWrist || !leftShoulder || !rightShoulder || !leftHip || !rightHip || !nose) {
    return 'unknown';
  }

  const allVisible = [leftWrist, rightWrist, leftShoulder, rightShoulder, leftHip, rightHip, nose]
    .every((lm) => (lm.visibility ?? 0) > 0.3);
  if (!allVisible) return 'unknown';

  const armUpThreshold = 0.1;
  if (leftWrist.y < nose.y - armUpThreshold || rightWrist.y < nose.y - armUpThreshold) {
    return 'arm_up';
  }

  const shoulderWidth = Math.abs(leftShoulder.x - rightShoulder.x);
  const wristSpan = Math.abs(leftWrist.x - rightWrist.x);
  const leftWristNearShoulderHeight = Math.abs(leftWrist.y - leftShoulder.y) < 0.12;
  const rightWristNearShoulderHeight = Math.abs(rightWrist.y - rightShoulder.y) < 0.12;

  if (wristSpan > shoulderWidth * 2.0 && leftWristNearShoulderHeight && rightWristNearShoulderHeight) {
    return 'arms_out';
  }

  const leftWristNearHip = Math.abs(leftWrist.y - leftHip.y) < 0.15;
  const rightWristNearHip = Math.abs(rightWrist.y - rightHip.y) < 0.15;
  const wristsClose = wristSpan < shoulderWidth * 2.0;

  if (leftWristNearHip && rightWristNearHip && wristsClose) {
    return 'standing';
  }

  return 'unknown';
}

function MeasureFlowContent({ onComplete, onBack }: MeasureFlowProps) {
  const searchParams = useSearchParams();
  const refId = searchParams.get('ref');
  const referenceObj = REFERENCE_OBJECTS.find((r) => r.id === refId) || REFERENCE_OBJECTS[0];
  const isManualCard = referenceObj.type === 'card';

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  
  const [ballDetectorReady, setBallDetectorReady] = useState(isManualCard);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('user');
  
  // If card, start directly at measuring_height
  const [phase, setPhase] = useState<FlowPhase>(isManualCard ? 'measuring_height' : 'detecting_ball');
  
  const [cmPerPixel, setCmPerPixel] = useState(0);
  const [ballPosition, setBallPosition] = useState<{ x: number; y: number; d: number } | null>(null);
  const [poseType, setPoseType] = useState<string>('unknown');
  const [sampleCount, setSampleCount] = useState(0);
  
  // Manual Calibration States
  const [frozenFrameSrc, setFrozenFrameSrc] = useState<string | null>(null);
  const [preCalculatedHeightPx, setPreCalculatedHeightPx] = useState<number | null>(null);

  const [validationError, setValidationError] = useState<string | null>(null);

  const stabilizer = useRef(new BallDetectionStabilizer(15));
  const measurementSamples = useRef<MeasurementResult[]>([]);
  const latestLandmarksRef = useRef<NormalizedLandmark[] | null>(null);
  const phaseRef = useRef(phase);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  const { initialize, isLoading, isReady, error, startDetectionLoop, stopDetectionLoop, cleanup } =
    usePoseDetection({
      onResults: (landmarks) => {
        latestLandmarksRef.current = landmarks;
        const pose = detectPoseType(landmarks);
        setPoseType(pose);

        if (!videoRef.current) return;
        const currentPhase = phaseRef.current;
        const expectedPose = currentPhase === 'measuring_height' ? 'standing' : null;

        if (expectedPose && pose === expectedPose) {
          const w = videoRef.current.videoWidth;
          const h = videoRef.current.videoHeight;
          
          if (isManualCard) {
            // For manual card, we just count samples until stable (no cmPerPixel yet)
            measurementSamples.current.push({ heightCm: 0 }); // Dummy
            setSampleCount(measurementSamples.current.length);
            
            if (measurementSamples.current.length >= SAMPLES_NEEDED) {
              // Freeze frame and extract pixel height
              const canvas = document.createElement('canvas');
              canvas.width = w;
              canvas.height = h;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                // If front camera, we need to flip the canvas context before drawing
                if (facingMode === 'user') {
                  ctx.translate(w, 0);
                  ctx.scale(-1, 1);
                }
                ctx.drawImage(videoRef.current, 0, 0, w, h);
                setFrozenFrameSrc(canvas.toDataURL('image/jpeg', 0.9));
              }

              // Calculate raw pixel height from head to floor (approx)
              const topOfHeadY = landmarks[LANDMARKS.NOSE].y * h; // simplified
              const floorY = Math.max(
                landmarks[LANDMARKS.LEFT_HEEL].y * h,
                landmarks[LANDMARKS.RIGHT_HEEL].y * h
              );
              setPreCalculatedHeightPx(Math.abs(floorY - topOfHeadY));
              
              setPhase('manual_calibration');
              stopDetectionLoop();
            }
          } else {
            // Standard ML ball logic
            if (cmPerPixel <= 0) return;
            const measurement = computeMeasurements(landmarks, cmPerPixel, w, h, referenceObj.sizeCm);
            measurementSamples.current.push(measurement);
            setSampleCount(measurementSamples.current.length);

            if (measurementSamples.current.length >= SAMPLES_NEEDED) {
              const avg = averageMeasurements(measurementSamples.current);
              measurementSamples.current = [];
              setSampleCount(0);

              const finalResults: MeasurementResult = {
                heightCm: avg.heightCm,
                cmPerPixel: Math.round(cmPerPixel * 10000) / 10000,
                ballDiameterPx: Math.round(referenceObj.sizeCm / cmPerPixel),
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
        } else {
          // Reset samples if pose is broken
          measurementSamples.current = [];
          setSampleCount(0);
        }
      },
    });

  const startCamera = useCallback(async () => {
    setCameraReady(false);
    setCameraError(null);

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    if (typeof window !== 'undefined' && (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia)) {
      setCameraError('Camera access requires a Secure Context (HTTPS or localhost).');
      return;
    }

    const constraintList: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: facingMode } }, audio: false },
      { video: true, audio: false },
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
      setCameraError(lastErr instanceof Error ? lastErr.message : 'Camera access denied.');
      return;
    }

    streamRef.current = stream;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(() => {});
        setCameraReady(true);
      };
    }

    if (!isManualCard) {
      try {
        await initBallDetector();
        setBallDetectorReady(true);
      } catch (err) {
        console.error(err);
      }
    }
    initialize();
  }, [facingMode, initialize, isManualCard]);

  useEffect(() => {
    let mounted = true;
    startCamera();

    return () => {
      mounted = false;
      stopDetectionLoop();
      cleanup();
      if (!isManualCard) closeBallDetector();
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
    };
  }, [facingMode]);

  // Ball detection loop
  useEffect(() => {
    if (!cameraReady || !ballDetectorReady || !videoRef.current || isManualCard) return;

    let frameId: number;
    let lastDetectionTime = -1;

    const detect = () => {
      if (!videoRef.current) return;
      const currentPhase = phaseRef.current;

      if (currentPhase !== 'detecting_ball' && currentPhase !== 'calibrating') return;

      const now = performance.now();
      if (now <= lastDetectionTime) {
        frameId = requestAnimationFrame(detect);
        return;
      }
      lastDetectionTime = now;

      const result = detectBasketball(videoRef.current, now, referenceObj.sizeCm);

      if (result.found) {
        setBallPosition({ x: result.centerX, y: result.centerY, d: result.diameterPx });
        stabilizer.current.addSample(result);

        if (currentPhase === 'detecting_ball') setPhase('calibrating');

        const stable = stabilizer.current.getStableResult(referenceObj.sizeCm);
        if (stable && (currentPhase === 'detecting_ball' || currentPhase === 'calibrating')) {
          setCmPerPixel(stable.cmPerPixel);
          setPhase('measuring_height');
        }
      } else {
        stabilizer.current.addSample(result);
        if (stabilizer.current.getMissedFrames() > 8) {
          setBallPosition(null);
          if (currentPhase === 'calibrating') setPhase('detecting_ball');
        }
      }

      frameId = requestAnimationFrame(detect);
    };

    detect();
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
    };
  }, [cameraReady, ballDetectorReady, isManualCard, referenceObj]);

  const handleRecalibrate = useCallback(() => {
    setPhase(isManualCard ? 'measuring_height' : 'detecting_ball');
    setCmPerPixel(0);
    setBallPosition(null);
    setValidationError(null);
    setSampleCount(0);
    setFrozenFrameSrc(null);
    measurementSamples.current = [];
    stabilizer.current.reset();
  }, [isManualCard]);

  // Start pose detection
  useEffect(() => {
    if (phase === 'measuring_height' && isReady && cameraReady && videoRef.current) {
      startDetectionLoop(videoRef.current);
    }
  }, [phase, isReady, cameraReady, startDetectionLoop]);

  // Draw overlay skeleton
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

      if (ballPosition && !isManualCard && (phase === 'detecting_ball' || phase === 'calibrating')) {
        const isLocked = phase === 'calibrating';
        const color = isLocked ? '#E85D2C' : '#C88B3D';
        const halfD = ballPosition.d / 2;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.setLineDash(isLocked ? [] : [6, 6]);
        ctx.strokeRect(ballPosition.x - halfD, ballPosition.y - halfD, ballPosition.d, ballPosition.d);
        ctx.setLineDash([]);
      }

      const landmarks = latestLandmarksRef.current;
      if (landmarks && phase.startsWith('measuring_')) {
        const expectedPose = phase === 'measuring_height' ? 'standing' : null;
        const poseCorrect = expectedPose === poseType;
        const lineColor = poseCorrect ? 'rgba(200, 139, 61, 0.9)' : 'rgba(242, 238, 228, 0.35)';
        const pointColor = poseCorrect ? '#C88B3D' : 'rgba(242, 238, 228, 0.5)';

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
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
  }, [cameraReady, ballPosition, phase, poseType, isManualCard]);

  return (
    <div className="relative flex flex-col h-full bg-black">
      {/* Manual Calibration Modal */}
      {phase === 'manual_calibration' && frozenFrameSrc && (
        <ManualCalibrationUI
          imageSrc={frozenFrameSrc}
          referenceSizeCm={referenceObj.sizeCm}
          onConfirm={(finalCmPerPixel) => {
            if (preCalculatedHeightPx) {
              const heightCm = (preCalculatedHeightPx * finalCmPerPixel) + 3.0; // add 3cm sole offset
              onComplete({
                heightCm: Math.round(heightCm * 10) / 10,
                cmPerPixel: Math.round(finalCmPerPixel * 10000) / 10000,
              });
            }
          }}
          onCancel={handleRecalibrate}
        />
      )}

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

        <div className="absolute top-4 right-4 z-20 pointer-events-auto">
          <button
            onClick={() => setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'))}
            className="w-10 h-10 flex items-center justify-center active:opacity-70"
            style={{ color: '#F2EEE4' }}
          >
            <SwitchCamera className="w-5 h-5" />
          </button>
        </div>

        {((!cameraReady && !cameraError) || (!ballDetectorReady && !cameraError)) && (
          <div className="absolute inset-0 flex items-center justify-center z-20" style={{ background: 'rgba(20,17,16,0.85)' }}>
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: '#C88B3D' }} />
          </div>
        )}

        {validationError && (
          <div className="absolute inset-0 flex items-end z-30 px-5 pb-8" style={{ background: 'rgba(20,17,16,0.95)' }}>
            <div className="w-full max-w-sm mx-auto">
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4" style={{ color: '#C88B3D' }} />
                <h3 className="text-sm font-semibold" style={{ color: '#F2EEE4' }}>Inaccurate reading</h3>
              </div>
              <p className="text-sm leading-relaxed mb-5" style={{ color: '#8B8478' }}>{validationError}</p>
              <div className="flex gap-3">
                <button onClick={onBack} className="flex-1 py-3 text-sm font-medium text-[#8B8478]">Cancel</button>
                <button onClick={handleRecalibrate} className="flex-1 py-3 text-sm font-semibold bg-[#C88B3D] text-[#141110] rounded">Try again</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div className="px-5 pt-4 pb-6 space-y-4 bg-[#141110] border-t border-[#C88B3D]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#C88B3D' }} />
            <span className="text-sm font-medium text-[#F2EEE4]">{PHASE_INFO[phase].title}</span>
          </div>
        </div>
        <p className="text-sm leading-snug text-[#8B8478]">{PHASE_INFO[phase].instruction}</p>
        
        {phase === 'measuring_height' && (
          <div className="space-y-2">
            <div className="flex-1 h-1 overflow-hidden bg-[#2A2521]">
              <div
                className="h-full transition-all duration-200"
                style={{
                  width: `${(sampleCount / SAMPLES_NEEDED) * 100}%`,
                  background: poseType === 'standing' ? '#C88B3D' : '#2A2521',
                }}
              />
            </div>
          </div>
        )}
        <button onClick={onBack} className="w-full py-3 text-sm font-medium text-[#8B8478]">Cancel</button>
      </div>
    </div>
  );
}

export default function MeasureFlow(props: MeasureFlowProps) {
  return (
    <Suspense fallback={<div className="h-full bg-black" />}>
      <MeasureFlowContent {...props} />
    </Suspense>
  );
}
