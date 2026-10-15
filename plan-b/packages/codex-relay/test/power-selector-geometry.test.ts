import { describe, expect, it } from "vitest";

import {
  powerCrossedIndices,
  powerDetentedProgress,
  powerHapticKind,
  powerProgressForPosition,
  powerProgressForIndex,
  powerSelectionIndexForPosition,
  powerSelectionIndexWithHysteresis,
  powerTapTransitionStops,
  powerTransitionDuration,
} from "../../../apps/mobile/src/components/chat/power-selector-geometry.js";

describe("Power selector geometry", () => {
  it("snaps a gesture to the nearest supported Power stop", () => {
    // Given
    const trackWidth = 230;
    const selectionCount = 6;

    // When
    const beforeStart = powerSelectionIndexForPosition(-20, trackWidth, selectionCount);
    const middle = powerSelectionIndexForPosition(132, trackWidth, selectionCount);
    const afterEnd = powerSelectionIndexForPosition(260, trackWidth, selectionCount);

    // Then
    expect([beforeStart, middle, afterEnd]).toEqual([0, 3, 5]);
  });

  it("tracks continuous progress between discrete Power stops", () => {
    // Given
    const trackWidth = 230;
    const selectionCount = 6;

    // When
    const firstPosition = 100;
    const secondPosition = 110;
    const selectedIndices = [firstPosition, secondPosition].map((position) =>
      powerSelectionIndexForPosition(position, trackWidth, selectionCount),
    );
    const progress = [firstPosition, secondPosition].map((position) =>
      powerProgressForPosition(position, trackWidth),
    );

    // Then
    expect(selectedIndices).toEqual([2, 2]);
    expect(progress).toEqual([0.425, 0.475]);
  });

  it("holds the active stop through small midpoint jitter", () => {
    // Given
    const selectionCount = 6;

    // When
    const towardNext = [0.51, 0.52].map((progress) =>
      powerSelectionIndexWithHysteresis(progress, 2, selectionCount),
    );
    const towardPrevious = [0.49, 0.48].map((progress) =>
      powerSelectionIndexWithHysteresis(progress, 3, selectionCount),
    );

    // Then
    expect(towardNext).toEqual([2, 3]);
    expect(towardPrevious).toEqual([3, 2]);
  });

  it("adds a continuous magnetic catch around each Power stop", () => {
    // Given
    const selectionCount = 6;

    // When
    const midpoint = powerDetentedProgress(0.5, selectionCount);
    const beforeStop = powerDetentedProgress(0.58, selectionCount);
    const stop = powerDetentedProgress(0.6, selectionCount);
    const afterStop = powerDetentedProgress(0.62, selectionCount);
    const progression = [0.5, 0.52, 0.54, 0.56, 0.58, 0.6].map((progress) =>
      powerDetentedProgress(progress, selectionCount),
    );

    // Then
    expect(midpoint).toBe(0.5);
    expect(beforeStop).toBeGreaterThan(0.58);
    expect(beforeStop).toBeLessThan(0.6);
    expect(stop).toBe(0.6);
    expect(afterStop).toBeGreaterThan(0.6);
    expect(afterStop).toBeLessThan(0.62);
    expect(progression.every((value, index) => index === 0 || value > progression[index - 1])).toBe(
      true,
    );
  });

  it("increases visual intensity monotonically toward Ultra", () => {
    // Given
    const selectionCount = 6;

    // When
    const progression = Array.from({ length: selectionCount }, (_, index) =>
      powerProgressForIndex(index, selectionCount),
    );

    // Then
    expect(progression).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("strengthens haptics for the final two Power stops", () => {
    // Given
    const selectionCount = 6;

    // When
    const haptics = [0, 3, 4, 5].map((index) => powerHapticKind(index, selectionCount));

    // Then
    expect(haptics).toEqual(["selection", "selection", "light", "medium"]);
  });

  it("reports every crossed stop in both gesture directions", () => {
    // Given
    const startingIndex = 2;

    // When
    const towardUltra = powerCrossedIndices(startingIndex, 5);
    const backToStart = powerCrossedIndices(5, startingIndex);

    // Then
    expect(towardUltra).toEqual([3, 4, 5]);
    expect(backToStart).toEqual([4, 3, 2]);
  });

  it("animates a regular tap through every magnetic Power stop", () => {
    // Given
    const selectionCount = 6;

    // When
    const towardUltra = powerTapTransitionStops(2, 5, selectionCount, false);
    const reducedMotion = powerTapTransitionStops(5, 3, selectionCount, true);

    // Then
    expect(towardUltra).toEqual([
      { duration: 90, index: 3, progress: 0.6 },
      { duration: 90, index: 4, progress: 0.8 },
      { duration: 90, index: 5, progress: 1 },
    ]);
    expect(reducedMotion).toEqual([
      { duration: 0, index: 4, progress: 0.8 },
      { duration: 0, index: 3, progress: 0.6 },
    ]);
  });

  it("smoothly lengthens the visual transition into and out of Ultra", () => {
    // Given
    const selectionCount = 6;

    // When
    const regularTransition = powerTransitionDuration(2, 3, selectionCount, false);
    const intoUltra = powerTransitionDuration(4, 5, selectionCount, false);
    const outOfUltra = powerTransitionDuration(5, 4, selectionCount, false);
    const reducedMotion = powerTransitionDuration(4, 5, selectionCount, true);

    // Then
    expect(regularTransition).toBe(130);
    expect(intoUltra).toBe(260);
    expect(outOfUltra).toBe(260);
    expect(reducedMotion).toBe(0);
  });
});
