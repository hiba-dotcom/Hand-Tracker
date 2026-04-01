import { useRef, useCallback, useState, useEffect } from "react";

export interface Landmark {
  x: number;
  y: number;
  z: number;
}

export interface HandResult {
  landmarks: Landmark[];
  handedness: "Left" | "Right";
}

export interface HandTrackingState {
  hands: HandResult[];
  isLoading: boolean;
  error: string | null;
  isActive: boolean;
}

const FINGER_NAMES = ["Thumb", "Index", "Middle", "Ring", "Pinky"] as const;

const CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];

export function getExtendedFingers(landmarks: Landmark[], handedness: "Left" | "Right"): boolean[] {
  const tips = [4, 8, 12, 16, 20];
  const pips = [3, 6, 10, 14, 18];

  return tips.map((tip, i) => {
    if (i === 0) {
      const thumbTip = landmarks[tip];
      const thumbIp = landmarks[pips[i]];
      const indexMcp = landmarks[5];
      if (handedness === "Right") {
        return thumbTip.x < thumbIp.x;
      } else {
        return thumbTip.x > thumbIp.x;
      }
    }
    return landmarks[tip].y < landmarks[pips[i]].y;
  });
}

export function countExtendedFingers(landmarks: Landmark[], handedness: "Left" | "Right"): number {
  return getExtendedFingers(landmarks, handedness).filter(Boolean).length;
}

export { CONNECTIONS, FINGER_NAMES };
