'use client';

import { useRef, useCallback, useState } from 'react';
import type { PoseLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';

interface UsePoseDetectionOptions {
  onResults?: (landmarks: NormalizedLandmark[], timestamp: number) => void;
}

export function usePoseDetection(options?: UsePoseDetectionOptions) {
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const animationFrameRef = useRef<number>(0);
  const lastTimestampRef = useRef<number>(-1);

  const initialize = useCallback(async () => {
    if (poseLandmarkerRef.current) return;

    setIsLoading(true);
    setError(null);

    try {
      // Dynamic import to avoid SSR issues
      const { PoseLandmarker, FilesetResolver } = await import(
        '@mediapipe/tasks-vision'
      );

      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.20/wasm'
      );

      const poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      poseLandmarkerRef.current = poseLandmarker;
      setIsReady(true);
    } catch (err) {
      console.error('Failed to initialize PoseLandmarker:', err);
      setError(
        err instanceof Error ? err.message : 'Failed to load pose detection model'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  const detectPose = useCallback(
    (videoElement: HTMLVideoElement) => {
      if (!poseLandmarkerRef.current) return;
      if (videoElement.readyState < 2) return; // HAVE_CURRENT_DATA

      const now = performance.now();
      // MediaPipe requires strictly increasing timestamps
      if (now <= lastTimestampRef.current) return;
      lastTimestampRef.current = now;

      try {
        const result = poseLandmarkerRef.current.detectForVideo(videoElement, now);
        if (result.landmarks && result.landmarks.length > 0) {
          options?.onResults?.(result.landmarks[0] as NormalizedLandmark[], now);
        }
      } catch {
        // Silently ignore frame processing errors
      }
    },
    [options]
  );

  const startDetectionLoop = useCallback(
    (videoElement: HTMLVideoElement) => {
      const loop = () => {
        detectPose(videoElement);
        animationFrameRef.current = requestAnimationFrame(loop);
      };
      loop();
    },
    [detectPose]
  );

  const stopDetectionLoop = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = 0;
    }
  }, []);

  const cleanup = useCallback(() => {
    stopDetectionLoop();
    if (poseLandmarkerRef.current) {
      poseLandmarkerRef.current.close();
      poseLandmarkerRef.current = null;
    }
    setIsReady(false);
    lastTimestampRef.current = -1;
  }, [stopDetectionLoop]);

  return {
    initialize,
    detectPose,
    startDetectionLoop,
    stopDetectionLoop,
    cleanup,
    isLoading,
    isReady,
    error,
  };
}
