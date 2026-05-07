/**
 * Measurement utility functions.
 * Uses MediaPipe PoseLandmarker normalized landmarks + a calibration ratio
 * to compute real-world body measurements.
 *
 * MediaPipe landmarks are normalized [0,1] relative to the image dimensions.
 * We convert to pixel coordinates, then multiply by the calibration ratio (cm/px).
 */

// MediaPipe Pose Landmark indices
// https://developers.google.com/mediapipe/solutions/vision/pose_landmarker
export const LANDMARKS = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export interface NormalizedLandmark {
  x: number; // 0..1, left to right
  y: number; // 0..1, top to bottom
  z: number;
  visibility?: number;
}

export interface MeasurementResult {
  heightCm: number;
  wingspanCm: number;
  standingReachCm: number;
}

/** Euclidean distance between two landmarks in pixel space */
function pixelDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  imgWidth: number,
  imgHeight: number
): number {
  const dx = (a.x - b.x) * imgWidth;
  const dy = (a.y - b.y) * imgHeight;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Vertical pixel distance (y-axis only) */
function verticalPixelDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  imgHeight: number
): number {
  return Math.abs((a.y - b.y) * imgHeight);
}

/**
 * Estimate the top-of-head position.
 * MediaPipe doesn't give us the crown of the head directly.
 * We extrapolate upward from the midpoint between eyes by a factor
 * proportional to the face size (distance from nose to eye midpoint).
 */
function estimateTopOfHead(
  landmarks: NormalizedLandmark[],
  imgWidth: number,
  imgHeight: number
): { x: number; y: number } {
  const nose = landmarks[LANDMARKS.NOSE];
  const leftEye = landmarks[LANDMARKS.LEFT_EYE];
  const rightEye = landmarks[LANDMARKS.RIGHT_EYE];
  const leftEar = landmarks[LANDMARKS.LEFT_EAR];
  const rightEar = landmarks[LANDMARKS.RIGHT_EAR];

  // Midpoint between eyes
  const eyeMidX = (leftEye.x + rightEye.x) / 2;
  const eyeMidY = (leftEye.y + rightEye.y) / 2;

  // Face height estimate: distance from nose to eye midpoint
  const faceUnit = verticalPixelDistance(
    nose,
    { x: eyeMidX, y: eyeMidY, z: 0 },
    imgHeight
  );

  // Ear-to-ear width as another reference
  const earWidth = pixelDistance(leftEar, rightEar, imgWidth, imgHeight);

  // Top of head is approximately 1.8x the nose-to-eye distance above the eye midpoint
  // or about 0.6x ear width, whichever is larger (more robust)
  const headExtension = Math.max(faceUnit * 1.8, earWidth * 0.55);

  return {
    x: eyeMidX * imgWidth,
    y: eyeMidY * imgHeight - headExtension,
  };
}

/**
 * Calculate the floor level from heel/foot landmarks.
 * Uses the lowest visible heel or foot index point.
 */
function getFloorY(
  landmarks: NormalizedLandmark[],
  imgHeight: number
): number {
  const candidates = [
    landmarks[LANDMARKS.LEFT_HEEL],
    landmarks[LANDMARKS.RIGHT_HEEL],
    landmarks[LANDMARKS.LEFT_FOOT_INDEX],
    landmarks[LANDMARKS.RIGHT_FOOT_INDEX],
  ];

  let maxY = 0;
  for (const lm of candidates) {
    if (lm && (lm.visibility ?? 0) > 0.3) {
      const py = lm.y * imgHeight;
      if (py > maxY) maxY = py;
    }
  }
  return maxY;
}

/**
 * Compute all three measurements from pose landmarks.
 * @param landmarks - Array of 33 normalized landmarks from MediaPipe
 * @param cmPerPixel - Calibration ratio from basketball detection
 * @param imgWidth - Video frame width in pixels
 * @param imgHeight - Video frame height in pixels
 */
export function computeMeasurements(
  landmarks: NormalizedLandmark[],
  cmPerPixel: number,
  imgWidth: number,
  imgHeight: number
): MeasurementResult {
  // --- HEIGHT ---
  const topOfHead = estimateTopOfHead(landmarks, imgWidth, imgHeight);
  const floorY = getFloorY(landmarks, imgHeight);
  const heightPx = floorY - topOfHead.y;
  const heightCm = heightPx * cmPerPixel;

  // --- WINGSPAN ---
  // Use index finger tips for maximum reach
  const leftIndex = landmarks[LANDMARKS.LEFT_INDEX];
  const rightIndex = landmarks[LANDMARKS.RIGHT_INDEX];

  // If index fingers aren't visible, fall back to wrists
  const leftWingTip =
    leftIndex && (leftIndex.visibility ?? 0) > 0.3
      ? leftIndex
      : landmarks[LANDMARKS.LEFT_WRIST];
  const rightWingTip =
    rightIndex && (rightIndex.visibility ?? 0) > 0.3
      ? rightIndex
      : landmarks[LANDMARKS.RIGHT_WRIST];

  const wingspanPx = pixelDistance(leftWingTip, rightWingTip, imgWidth, imgHeight);
  const wingspanCm = wingspanPx * cmPerPixel;

  // --- STANDING REACH ---
  // Highest fingertip (lowest y value) when arm is raised
  const fingertips = [
    landmarks[LANDMARKS.LEFT_INDEX],
    landmarks[LANDMARKS.RIGHT_INDEX],
    landmarks[LANDMARKS.LEFT_PINKY],
    landmarks[LANDMARKS.RIGHT_PINKY],
    landmarks[LANDMARKS.LEFT_WRIST],
    landmarks[LANDMARKS.RIGHT_WRIST],
  ];

  let highestY = Infinity;
  for (const ft of fingertips) {
    if (ft && (ft.visibility ?? 0) > 0.3) {
      const py = ft.y * imgHeight;
      if (py < highestY) highestY = py;
    }
  }

  const standingReachPx = floorY - highestY;
  const standingReachCm = standingReachPx * cmPerPixel;

  return {
    heightCm: Math.round(heightCm * 10) / 10,
    wingspanCm: Math.round(wingspanCm * 10) / 10,
    standingReachCm: Math.round(standingReachCm * 10) / 10,
  };
}

/**
 * Average multiple measurement samples for stability.
 */
export function averageMeasurements(
  samples: MeasurementResult[]
): MeasurementResult {
  if (samples.length === 0) {
    return { heightCm: 0, wingspanCm: 0, standingReachCm: 0 };
  }

  const sum = samples.reduce(
    (acc, s) => ({
      heightCm: acc.heightCm + s.heightCm,
      wingspanCm: acc.wingspanCm + s.wingspanCm,
      standingReachCm: acc.standingReachCm + s.standingReachCm,
    }),
    { heightCm: 0, wingspanCm: 0, standingReachCm: 0 }
  );

  const n = samples.length;
  return {
    heightCm: Math.round((sum.heightCm / n) * 10) / 10,
    wingspanCm: Math.round((sum.wingspanCm / n) * 10) / 10,
    standingReachCm: Math.round((sum.standingReachCm / n) * 10) / 10,
  };
}

// Size 7 basketball diameter in cm
export const BASKETBALL_DIAMETER_CM = 24.1;
