export const storeReviewSuccessfulConversationThreshold = 5;

export type StoreReviewGateState = {
  readonly hasRequestedReview: boolean;
  readonly successfulConversationCount: number;
};

export type NextStoreReviewGateState = StoreReviewGateState & {
  readonly shouldRequestReview: boolean;
};

export function nextStoreReviewGateState(state: StoreReviewGateState): NextStoreReviewGateState {
  if (state.hasRequestedReview) {
    return {
      hasRequestedReview: true,
      shouldRequestReview: false,
      successfulConversationCount: normalizedSuccessfulConversationCount(
        state.successfulConversationCount,
      ),
    };
  }

  const successfulConversationCount =
    normalizedSuccessfulConversationCount(state.successfulConversationCount) + 1;
  const shouldRequestReview =
    successfulConversationCount >= storeReviewSuccessfulConversationThreshold;

  return {
    hasRequestedReview: shouldRequestReview,
    shouldRequestReview,
    successfulConversationCount,
  };
}

function normalizedSuccessfulConversationCount(count: number) {
  if (!Number.isFinite(count) || count <= 0) {
    return 0;
  }
  return Math.trunc(count);
}
