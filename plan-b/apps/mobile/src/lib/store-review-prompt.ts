import * as StoreReview from "expo-store-review";
import { createMMKV } from "react-native-mmkv";

import { nextStoreReviewGateState, type StoreReviewGateState } from "@/lib/store-review-gate";

const storeReviewStateStorageId = "codex-relay-store-review";
const successfulConversationCountStorageKey =
  "codex-relay.store-review.successful-conversation-count";
const hasRequestedReviewStorageKey = "codex-relay.store-review.has-requested-review";

const storage = createMMKV({ id: storeReviewStateStorageId });

export function recordSuccessfulAiConversationForReviewPrompt() {
  const nextState = nextStoreReviewGateState(readStoreReviewGateState());
  writeStoreReviewGateState(nextState);

  if (!nextState.shouldRequestReview) {
    return;
  }

  void requestReviewIfAvailable();
}

function readStoreReviewGateState(): StoreReviewGateState {
  return {
    hasRequestedReview: storage.getBoolean(hasRequestedReviewStorageKey) ?? false,
    successfulConversationCount: storage.getNumber(successfulConversationCountStorageKey) ?? 0,
  };
}

function writeStoreReviewGateState(state: StoreReviewGateState) {
  storage.set(hasRequestedReviewStorageKey, state.hasRequestedReview);
  storage.set(successfulConversationCountStorageKey, state.successfulConversationCount);
}

async function requestReviewIfAvailable() {
  try {
    if (await StoreReview.isAvailableAsync()) {
      await StoreReview.requestReview();
    }
  } catch (error) {
    if (error instanceof Error) {
      return;
    }
  }
}
