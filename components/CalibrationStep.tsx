'use client';

import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Camera, CheckCircle, RotateCcw } from 'lucide-react';
import { BASKETBALL_DIAMETER_CM } from '@/lib/measurements';

interface CalibrationStepProps {
  onCalibrated: (cmPerPixel: number) => void;
  onBack: () => void;
}

export default function CalibrationStep({ onCalibrated, onBack }: CalibrationStepProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [instruction, setInstruction] = useState('Position the basketball on the floor in view');
  const [circleSize, setCircleSize] = useState(150); // Guide circle diameter in px
  const [isConfirming, setIsConfirming] = useState(false);

  // Start camera
  useEffect(() => {
    let mounted = true;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment', // Back camera for calibration
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
      } catch (err) {
        console.error('Camera access denied:', err);
        setInstruction('Camera access denied. Please allow camera permissions.');
      }
    }

    startCamera();

    return () => {
      mounted = false;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // Draw guide overlay
  useEffect(() => {
    if (!cameraReady || !canvasRef.current || !videoRef.current) return;

    const canvas = canvasRef.current;
    const video = videoRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    let frameId: number;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Semi-transparent overlay
      ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Cut out circle in center
      const cx = canvas.width / 2;
      const cy = canvas.height / 2;
      // Scale circle size relative to canvas
      const scaledRadius = (circleSize / 2) * (canvas.width / 400);

      ctx.save();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(cx, cy, scaledRadius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Draw circle border
      ctx.strokeStyle = isConfirming ? '#22c55e' : '#ffffff';
      ctx.lineWidth = 3;
      ctx.setLineDash(isConfirming ? [] : [10, 10]);
      ctx.beginPath();
      ctx.arc(cx, cy, scaledRadius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.max(14, canvas.width / 30)}px Inter, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('Align basketball here', cx, cy + scaledRadius + 30);

      frameId = requestAnimationFrame(draw);
    };

    draw();

    return () => cancelAnimationFrame(frameId);
  }, [cameraReady, circleSize, isConfirming]);

  // Resize circle with pinch/scroll
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setCircleSize((prev) => Math.max(60, Math.min(300, prev - e.deltaY * 0.5)));
  }, []);

  // Confirm calibration
  const handleConfirm = useCallback(() => {
    if (!canvasRef.current || !videoRef.current) return;

    setIsConfirming(true);
    setInstruction('Calibrating...');

    const canvas = canvasRef.current;
    // The guide circle diameter in canvas pixels
    const scaledDiameter = circleSize * (canvas.width / 400);

    // cm per pixel = known diameter (cm) / measured diameter (px)
    const cmPerPixel = BASKETBALL_DIAMETER_CM / scaledDiameter;

    setTimeout(() => {
      // Stop the camera
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
      onCalibrated(cmPerPixel);
    }, 800);
  }, [circleSize, onCalibrated]);

  // Slider for mobile (since pinch is harder to implement)
  const handleSliderChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setCircleSize(Number(e.target.value));
  }, []);

  return (
    <div className="relative flex flex-col h-full bg-black">
      {/* Video feed */}
      <div className="relative flex-1 overflow-hidden" onWheel={handleWheel}>
        <video
          ref={videoRef}
          className="absolute inset-0 w-full h-full object-cover"
          autoPlay
          playsInline
          muted
        />
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full object-cover"
        />

        {!cameraReady && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900">
            <div className="flex flex-col items-center gap-3">
              <Camera className="w-10 h-10 text-zinc-400 animate-pulse" />
              <p className="text-zinc-400 text-sm">Starting camera...</p>
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800 px-4 py-5 space-y-4">
        <p className="text-white text-center text-sm font-medium">{instruction}</p>

        {cameraReady && !isConfirming && (
          <>
            {/* Size slider */}
            <div className="space-y-2">
              <label className="text-zinc-400 text-xs block text-center">
                Adjust circle to match basketball size
              </label>
              <input
                type="range"
                min="60"
                max="300"
                value={circleSize}
                onChange={handleSliderChange}
                className="w-full accent-blue-500"
              />
            </div>

            {/* Action buttons */}
            <div className="flex gap-3">
              <button
                onClick={onBack}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl bg-zinc-800 text-zinc-300 text-sm font-medium transition-colors hover:bg-zinc-700 active:bg-zinc-600"
              >
                <RotateCcw className="w-4 h-4" />
                Back
              </button>
              <button
                onClick={handleConfirm}
                className="flex-[2] flex items-center justify-center gap-2 py-3 rounded-xl bg-blue-600 text-white text-sm font-semibold transition-all hover:bg-blue-500 active:scale-[0.98]"
              >
                <CheckCircle className="w-4 h-4" />
                Confirm Alignment
              </button>
            </div>
          </>
        )}

        {isConfirming && (
          <div className="flex items-center justify-center py-3">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>
    </div>
  );
}
