/**
 * Basketball detector using MediaPipe ObjectDetector (ML-based).
 * Uses EfficientDet-Lite0 trained on COCO dataset to detect "sports ball".
 * Much more robust than color-based detection — works in any lighting,
 * regardless of clothing color or background.
 */

import { BASKETBALL_DIAMETER_CM } from './measurements';

export interface BallDetectionResult {
  found: boolean;
  centerX: number;
  centerY: number;
  diameterPx: number;
  cmPerPixel: number;
  confidence: number;
  boundingBox: { x: number; y: number; width: number; height: number };
}

// We dynamically import @mediapipe/tasks-vision to avoid SSR issues
type ObjectDetectorType = import('@mediapipe/tasks-vision').ObjectDetector;

let objectDetector: ObjectDetectorType | null = null;
let isInitializing = false;

/**
 * Initialize the MediaPipe ObjectDetector.
 * Uses EfficientDet-Lite0 which can detect 80 COCO categories including "sports ball".
 */
export async function initBallDetector(): Promise<void> {
  if (objectDetector || isInitializing) return;
  isInitializing = true;

  try {
    const { ObjectDetector, FilesetResolver } = await import(
      '@mediapipe/tasks-vision'
    );

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
    );

    objectDetector = await ObjectDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/int8/1/efficientdet_lite0.tflite',
        delegate: 'CPU',
      },
      runningMode: 'VIDEO',
      scoreThreshold: 0.15,
      maxResults: 5,
    });
    console.log('ObjectDetector initialized successfully');
  } catch (err) {
    console.error('Failed to initialize ObjectDetector:', err);
    throw err;
  } finally {
    isInitializing = false;
  }
}

/**
 * Detect a basketball (sports ball) in the given video frame using ML.
 */
export function detectBasketball(
  videoElement: HTMLVideoElement,
  timestamp: number
): BallDetectionResult {
  const empty: BallDetectionResult = {
    found: false,
    centerX: 0,
    centerY: 0,
    diameterPx: 0,
    cmPerPixel: 0,
    confidence: 0,
    boundingBox: { x: 0, y: 0, width: 0, height: 0 },
  };

  if (!objectDetector) return empty;
  if (videoElement.readyState < 2) return empty;

  try {
    const result = objectDetector.detectForVideo(videoElement, timestamp);

    if (!result.detections || result.detections.length === 0) return empty;

    // We strictly look for "sports ball" to avoid misidentifying people as bottles/books
    const primaryLabel = 'sports ball';
    const fallbackLabels = ['ball', 'frisbee']; 
    
    let bestBall = null;
    let bestScore = 0;
    let isPrimary = false;

    // Log all raw detections for debugging
    if (result.detections.length > 0) {
      const labels = result.detections.flatMap(d => d.categories.map(c => `${c.categoryName}(${Math.round((c.score??0)*100)}%)`));
      console.log('AI Sees:', labels.join(', '));
    } else {
      // console.log('AI is looking but sees nothing...'); // Un-comment if you want to spam console to prove it's running
    }

    for (const detection of result.detections) {
      if (!detection.categories || !detection.boundingBox) continue;

      for (const category of detection.categories) {
        const name = (category.categoryName || '').toLowerCase();
        const score = category.score ?? 0;

        // Prioritize "sports ball" even if other labels have slightly higher scores
        const matchesPrimary = name === primaryLabel;
        const matchesFallback = fallbackLabels.includes(name);

        if (matchesPrimary) {
          if (!isPrimary || score > bestScore) {
            bestBall = detection;
            bestScore = score;
            isPrimary = true;
          }
        } else if (matchesFallback && !isPrimary) {
          if (score > bestScore) {
            bestBall = detection;
            bestScore = score;
          }
        }
      }
    }

    if (!bestBall || !bestBall.boundingBox) {
      return empty;
    }

    console.log('Target Locked:', bestBall.categories[0].categoryName, 'Score:', bestBall.categories[0].score);

    const bb = bestBall.boundingBox;
    const originX = bb.originX ?? (bb as unknown as Record<string, number>).x ?? 0;
    const originY = bb.originY ?? (bb as unknown as Record<string, number>).y ?? 0;
    const width = bb.width;
    const height = bb.height;

    // Estimate diameter as average of bbox width and height
    const diameterPx = (width + height) / 2;

    // Center of the bounding box
    const centerX = originX + width / 2;
    const centerY = originY + height / 2;

    // Sanity check: diameter shouldn't be too small or too large
    // A basketball at 2-5m distance should be between 5% and 25% of screen height
    const imgWidth = videoElement.videoWidth;
    const imgHeight = videoElement.videoHeight;
    const minSize = Math.min(imgWidth, imgHeight) * 0.05;
    const maxSize = Math.min(imgWidth, imgHeight) * 0.3;
    
    if (diameterPx < minSize || diameterPx > maxSize) {
      console.warn('Object detected but failed sanity check (size):', diameterPx, 'Allowed:', minSize, '-', maxSize);
      return empty;
    }

    const cmPerPixel = BASKETBALL_DIAMETER_CM / diameterPx;

    return {
      found: true,
      centerX,
      centerY,
      diameterPx,
      cmPerPixel,
      confidence: bestScore,
      boundingBox: { x: originX, y: originY, width, height },
    };
  } catch (err) {
    console.error('Error in detectBasketball:', err);
    return empty;
  }
}

/**
 * Cleanup the object detector.
 */
export function closeBallDetector(): void {
  if (objectDetector) {
    objectDetector.close();
    objectDetector = null;
  }
}

/**
 * Stabilize detection results by averaging over multiple frames.
 */
export class BallDetectionStabilizer {
  private samples: BallDetectionResult[] = [];
  private maxSamples: number;

  constructor(maxSamples = 20) {
    this.maxSamples = maxSamples;
  }

  addSample(result: BallDetectionResult): void {
    if (!result.found) return;
    this.samples.push(result);
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }

  isStable(): boolean {
    return this.samples.length >= this.maxSamples * 0.7;
  }

  getStableResult(): BallDetectionResult | null {
    if (!this.isStable()) return null;

    const n = this.samples.length;
    const avgDiameter = this.samples.reduce((s, r) => s + r.diameterPx, 0) / n;
    const avgCenterX = this.samples.reduce((s, r) => s + r.centerX, 0) / n;
    const avgCenterY = this.samples.reduce((s, r) => s + r.centerY, 0) / n;
    const avgConfidence = this.samples.reduce((s, r) => s + r.confidence, 0) / n;

    // Check consistency — diameter shouldn't vary too much
    const diameterStdDev = Math.sqrt(
      this.samples.reduce((s, r) => s + (r.diameterPx - avgDiameter) ** 2, 0) / n
    );
    const coeffOfVariation = diameterStdDev / avgDiameter;

    if (coeffOfVariation > 0.2) return null; // Too unstable

    return {
      found: true,
      centerX: avgCenterX,
      centerY: avgCenterY,
      diameterPx: avgDiameter,
      cmPerPixel: BASKETBALL_DIAMETER_CM / avgDiameter,
      confidence: avgConfidence,
      boundingBox: { x: 0, y: 0, width: avgDiameter, height: avgDiameter },
    };
  }

  reset(): void {
    this.samples = [];
  }
}
