export const POWER_THUMB_SIZE = 30;

export type PowerHapticKind = "selection" | "light" | "medium";

const DEFAULT_POWER_TRANSITION_MS = 130;
const ULTRA_POWER_TRANSITION_MS = 260;
const POWER_SELECTION_HYSTERESIS_RATIO = 0.08;
const POWER_DETENT_STRENGTH = 0.48;
const POWER_TAP_STEP_MS = 90;

export function powerProgressForPosition(position: number, trackWidth: number) {
  "worklet";

  if (trackWidth <= POWER_THUMB_SIZE) {
    return 0;
  }

  const usableWidth = trackWidth - POWER_THUMB_SIZE;
  const positionFromFirstStop = Math.min(Math.max(position - POWER_THUMB_SIZE / 2, 0), usableWidth);
  return positionFromFirstStop / usableWidth;
}

export function powerSelectionIndexForPosition(
  position: number,
  trackWidth: number,
  selectionCount: number,
) {
  "worklet";

  if (selectionCount <= 1) {
    return 0;
  }

  return Math.round(powerProgressForPosition(position, trackWidth) * (selectionCount - 1));
}

export function powerSelectionIndexWithHysteresis(
  progress: number,
  currentIndex: number,
  selectionCount: number,
) {
  "worklet";

  if (selectionCount <= 1) {
    return 0;
  }

  const lastIndex = selectionCount - 1;
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const clampedCurrentIndex = Math.min(Math.max(currentIndex, 0), lastIndex);
  const nearestIndex = Math.round(clampedProgress * lastIndex);
  if (nearestIndex === clampedCurrentIndex) {
    return clampedCurrentIndex;
  }

  const direction = nearestIndex > clampedCurrentIndex ? 1 : -1;
  const step = 1 / lastIndex;
  const midpoint = (clampedCurrentIndex + direction * 0.5) * step;
  const threshold = midpoint + direction * step * POWER_SELECTION_HYSTERESIS_RATIO;
  const crossedThreshold =
    direction > 0 ? clampedProgress >= threshold : clampedProgress <= threshold;
  return crossedThreshold ? nearestIndex : clampedCurrentIndex;
}

export function powerDetentedProgress(progress: number, selectionCount: number) {
  "worklet";

  if (selectionCount <= 1) {
    return 0;
  }

  const lastIndex = selectionCount - 1;
  const scaledProgress = Math.min(Math.max(progress, 0), 1) * lastIndex;
  const nearestIndex = Math.round(scaledProgress);
  const offsetFromStop = scaledProgress - nearestIndex;
  const normalizedDistance = Math.min(Math.abs(offsetFromStop) * 2, 1);
  const influence = (1 - normalizedDistance) ** 2;
  const detentedProgress = scaledProgress - offsetFromStop * POWER_DETENT_STRENGTH * influence;
  return detentedProgress / lastIndex;
}

export function powerProgressForIndex(index: number, selectionCount: number) {
  "worklet";

  if (selectionCount <= 1) {
    return 0;
  }

  return Math.min(Math.max(index, 0), selectionCount - 1) / (selectionCount - 1);
}

export function powerCrossedIndices(fromIndex: number, toIndex: number) {
  "worklet";

  if (fromIndex === toIndex) {
    return [];
  }

  const direction = toIndex > fromIndex ? 1 : -1;
  const crossedIndices: number[] = [];
  for (
    let crossedIndex = fromIndex + direction;
    direction > 0 ? crossedIndex <= toIndex : crossedIndex >= toIndex;
    crossedIndex += direction
  ) {
    crossedIndices.push(crossedIndex);
  }
  return crossedIndices;
}

export function powerTapTransitionStops(
  fromIndex: number,
  toIndex: number,
  selectionCount: number,
  reduceMotion: boolean,
) {
  "worklet";

  return powerCrossedIndices(fromIndex, toIndex).map((index) => ({
    duration: reduceMotion ? 0 : POWER_TAP_STEP_MS,
    index,
    progress: powerProgressForIndex(index, selectionCount),
  }));
}

export function powerTransitionDuration(
  fromIndex: number,
  toIndex: number,
  selectionCount: number,
  reduceMotion: boolean,
) {
  "worklet";

  if (reduceMotion) {
    return 0;
  }
  return Math.max(fromIndex, toIndex) === selectionCount - 1
    ? ULTRA_POWER_TRANSITION_MS
    : DEFAULT_POWER_TRANSITION_MS;
}

export function powerHapticKind(index: number, selectionCount: number): PowerHapticKind {
  if (index >= selectionCount - 1) {
    return "medium";
  }
  if (index === selectionCount - 2) {
    return "light";
  }
  return "selection";
}
