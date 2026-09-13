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
  wingspanCm?: number;
  standingReachCm?: number;
  ballDiameterPx?: number;
  cmPerPixel?: number;
}

/** 
 * Euclidean distance between two landmarks.
 * @param use3D - If true, incorporates the Z-axis (depth) for better accuracy
 */
function pixelDistance(
  a: NormalizedLandmark,
  b: NormalizedLandmark,
  imgWidth: number,
  imgHeight: number,
  use3D: boolean = true
): number {
  const dx = (a.x - b.x) * imgWidth;
  const dy = (a.y - b.y) * imgHeight;
  
  if (use3D) {
    const dz = (a.z - b.z) * imgWidth;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  
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
 * Estimate the top-of-head position (crown of skull/hair).
 * Extrapolates upward from eyes based on ear width and face unit.
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

  // Ear-to-ear width as reference
  const earWidth = pixelDistance(leftEar, rightEar, imgWidth, imgHeight, false);

  // Crown of head is approximately 0.85x ear width or 3.2x nose-to-eye distance above eye midpoint
  const headExtension = Math.max(faceUnit * 3.2, earWidth * 0.85);

  return {
    x: eyeMidX * imgWidth,
    y: eyeMidY * imgHeight - headExtension,
  };
}

/**
 * Calculate the floor level from heel/foot landmarks.
 * Adds sole padding (approx 3cm) below heel/toe keypoints to account for shoe sole.
 */
function getFloorY(
  landmarks: NormalizedLandmark[],
  imgHeight: number,
  cmPerPixel: number
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

  // Add 3.0 cm of sole/ground contact padding below heel landmark
  const soleOffsetPx = cmPerPixel > 0 ? 3.0 / cmPerPixel : 0;
  return maxY + soleOffsetPx;
}

/**
 * Compute all three measurements from pose landmarks.
 */
export function computeMeasurements(
  landmarks: NormalizedLandmark[],
  cmPerPixel: number,
  imgWidth: number,
  imgHeight: number,
  referenceSizeCm: number = 24.1
): MeasurementResult {
  // --- HEIGHT ---
  const topOfHead = estimateTopOfHead(landmarks, imgWidth, imgHeight);
  const floorY = getFloorY(landmarks, imgHeight, cmPerPixel);
  const heightPx = floorY - topOfHead.y;
  const heightCm = heightPx * cmPerPixel;

  // --- WINGSPAN (Segmented 3D Approach) ---
  const leftShoulder = landmarks[LANDMARKS.LEFT_SHOULDER];
  const rightShoulder = landmarks[LANDMARKS.RIGHT_SHOULDER];
  const leftElbow = landmarks[LANDMARKS.LEFT_ELBOW];
  const rightElbow = landmarks[LANDMARKS.RIGHT_ELBOW];
  const leftWrist = landmarks[LANDMARKS.LEFT_WRIST];
  const rightWrist = landmarks[LANDMARKS.RIGHT_WRIST];
  const leftIndex = landmarks[LANDMARKS.LEFT_INDEX];
  const rightIndex = landmarks[LANDMARKS.RIGHT_INDEX];

  // 1. Shoulder to Shoulder
  const shoulderWidthPx = pixelDistance(leftShoulder, rightShoulder, imgWidth, imgHeight, true);
  
  // 2. Upper Arms (Shoulder to Elbow)
  const leftUpperArmPx = pixelDistance(leftShoulder, leftElbow, imgWidth, imgHeight, true);
  const rightUpperArmPx = pixelDistance(rightShoulder, rightElbow, imgWidth, imgHeight, true);
  
  // 3. Forearms (Elbow to Wrist)
  const leftForearmPx = pixelDistance(leftElbow, leftWrist, imgWidth, imgHeight, true);
  const rightForearmPx = pixelDistance(rightElbow, rightWrist, imgWidth, imgHeight, true);
  
  // 4. Hands (Wrist to Tip)
  const HAND_LENGTH_CM = 19; // Average adult hand length
  const handLengthPx = HAND_LENGTH_CM / cmPerPixel;

  const getHandPx = (wrist: NormalizedLandmark, index: NormalizedLandmark) => {
    if (index && (index.visibility ?? 0) > 0.4) {
      return pixelDistance(wrist, index, imgWidth, imgHeight, true);
    }
    return handLengthPx;
  };

  const leftHandPx = getHandPx(leftWrist, leftIndex);
  const rightHandPx = getHandPx(rightWrist, rightIndex);

  const wingspanPx = 
    shoulderWidthPx + 
    leftUpperArmPx + rightUpperArmPx + 
    leftForearmPx + rightForearmPx + 
    leftHandPx + rightHandPx;

  const wingspanCm = wingspanPx * cmPerPixel;

  // --- STANDING REACH ---
  const fingertips = [
    landmarks[LANDMARKS.LEFT_INDEX],
    landmarks[LANDMARKS.RIGHT_INDEX],
    landmarks[LANDMARKS.LEFT_PINKY],
    landmarks[LANDMARKS.RIGHT_PINKY],
    landmarks[LANDMARKS.LEFT_WRIST],
    landmarks[LANDMARKS.RIGHT_WRIST],
  ];

  let highestY = Infinity;
  let highestFT = fingertips[0];
  for (const ft of fingertips) {
    if (ft && (ft.visibility ?? 0) > 0.3) {
      const py = ft.y * imgHeight;
      if (py < highestY) {
        highestY = py;
        highestFT = ft;
      }
    }
  }

  const standingReachPx = floorY - highestY;
  let standingReachCm = standingReachPx * cmPerPixel;
  
  if (highestFT === landmarks[LANDMARKS.LEFT_WRIST] || highestFT === landmarks[LANDMARKS.RIGHT_WRIST]) {
    standingReachCm += 18;
  }

  return {
    heightCm: Math.round(heightCm * 10) / 10,
    wingspanCm: Math.round(wingspanCm * 10) / 10,
    standingReachCm: Math.round(standingReachCm * 10) / 10,
    cmPerPixel: Math.round(cmPerPixel * 10000) / 10000,
    ballDiameterPx: Math.round(referenceSizeCm / cmPerPixel),
  };
}

/**
 * Validate measurements against human biological norms.
 */
export function validateMeasurements(result: MeasurementResult): {
  valid: boolean;
  reason?: string;
} {
  // Height check: 100cm to 250cm
  if (result.heightCm < 100) return { valid: false, reason: "Height seems too short. Check basketball calibration." };
  if (result.heightCm > 250) return { valid: false, reason: "Height seems too tall. Check basketball calibration." };

  // Wingspan check: Typically 0.8x to 1.35x of height
  if (result.wingspanCm !== undefined) {
    const ratio = result.wingspanCm / result.heightCm;
    if (ratio < 0.7) return { valid: false, reason: "Wingspan seems too short for your height." };
    if (ratio > 1.4) return { valid: false, reason: "Wingspan seems too long for your height." };
  }

  return { valid: true };
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

  const sum = samples.reduce<{
    heightCm: number;
    wingspanCm: number;
    standingReachCm: number;
    cmPerPixel: number;
    ballDiameterPx: number;
  }>(
    (acc, s) => ({
      heightCm: acc.heightCm + s.heightCm,
      wingspanCm: acc.wingspanCm + (s.wingspanCm ?? 0),
      standingReachCm: acc.standingReachCm + (s.standingReachCm ?? 0),
      cmPerPixel: acc.cmPerPixel + (s.cmPerPixel ?? 0),
      ballDiameterPx: acc.ballDiameterPx + (s.ballDiameterPx ?? 0),
    }),
    { heightCm: 0, wingspanCm: 0, standingReachCm: 0, cmPerPixel: 0, ballDiameterPx: 0 }
  );

  const n = samples.length;
  return {
    heightCm: Math.round((sum.heightCm / n) * 10) / 10,
    wingspanCm: Math.round((sum.wingspanCm / n) * 10) / 10,
    standingReachCm: Math.round((sum.standingReachCm / n) * 10) / 10,
    cmPerPixel: Math.round((sum.cmPerPixel / n) * 10000) / 10000,
    ballDiameterPx: Math.round(sum.ballDiameterPx / n),
  };
}

// Size 7 basketball diameter in cm is now part of REFERENCE_OBJECTS
export type ReferenceType = 'ball' | 'card';

export interface ReferenceObject {
  id: string;
  name: string;
  type: ReferenceType;
  sizeCm: number; // Diameter for balls, width for ATM card
}

export const REFERENCE_OBJECTS: ReferenceObject[] = [
  { id: 'basketball_7', name: 'Basketball (Size 7)', type: 'ball', sizeCm: 24.1 },
  { id: 'basketball_6', name: 'Women\'s Basketball (Size 6)', type: 'ball', sizeCm: 23.0 },
  { id: 'soccer_5', name: 'Soccer Ball (Size 5)', type: 'ball', sizeCm: 22.0 },
  { id: 'volleyball', name: 'Volleyball', type: 'ball', sizeCm: 21.0 },
  { id: 'tennis', name: 'Tennis Ball', type: 'ball', sizeCm: 6.7 },
  { id: 'atm_card', name: 'ATM / Credit Card', type: 'card', sizeCm: 8.56 },
];

