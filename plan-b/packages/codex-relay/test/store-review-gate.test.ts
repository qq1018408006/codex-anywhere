import { describe, expect, it } from "vitest";

import { nextStoreReviewGateState } from "../../../apps/mobile/src/lib/store-review-gate.js";

describe("store review gate", () => {
  it("requests review only on the fifth successful conversation", () => {
    expect(
      nextStoreReviewGateState({
        hasRequestedReview: false,
        successfulConversationCount: 4,
      }),
    ).toEqual({
      hasRequestedReview: true,
      shouldRequestReview: true,
      successfulConversationCount: 5,
    });
  });

  it("does not request review again after it has been shown once", () => {
    expect(
      nextStoreReviewGateState({
        hasRequestedReview: true,
        successfulConversationCount: 5,
      }),
    ).toEqual({
      hasRequestedReview: true,
      shouldRequestReview: false,
      successfulConversationCount: 5,
    });
  });
});
