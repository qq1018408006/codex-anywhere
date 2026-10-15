const test = require("node:test");
const assert = require("node:assert/strict");
const { keepPendingSubmitDraft } = require("../src/server/submit-draft.js");

test("a late submission clear keeps text typed while the request was pending", () => {
  let text = "submitted prompt";
  const composer = {
    getPersistedText: () => text,
    setPromptText: (value) => {
      text = value;
    },
    view: { isDestroyed: false },
  };
  const clear = keepPendingSubmitDraft(composer, text, () => {
    text = "";
  });
  clear();
  assert.equal(text, "");
  text = "the next prompt\nwith multiple lines";
  clear();
  assert.equal(text, "the next prompt\nwith multiple lines");
});

test("preparation finishing does not overwrite edits made before acceptance", () => {
  let text = "submitted prompt";
  const composer = {
    getPersistedText: () => text,
    setPromptText: (value) => {
      text = value;
    },
    view: { isDestroyed: false },
  };
  const clear = keepPendingSubmitDraft(composer, text, () => {
    text = "";
  });
  text = "edited while preparing";
  clear();
  assert.equal(text, "edited while preparing");
});
