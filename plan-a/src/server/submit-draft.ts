type DraftComposer = {
  getPersistedText: () => string;
  setPromptText: (text: string) => void;
  view: { isDestroyed: boolean };
};

// An accepted submission may clear again after a slow reply (for example,
// queued input). Only the submitted draft belongs to that request.
export function keepPendingSubmitDraft(
  composer: DraftComposer,
  submittedDraft: string,
  clear: (...args: unknown[]) => unknown,
) {
  let cleared = false;
  return (...args: unknown[]) => {
    const draft = composer.getPersistedText();
    const preserve = cleared || draft !== submittedDraft;
    const result = clear(...args);
    cleared = true;
    if (preserve && draft && !composer.view.isDestroyed)
      composer.setPromptText(draft);
    return result;
  };
}
