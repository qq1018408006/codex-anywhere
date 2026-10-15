import assert from "node:assert/strict";
import Module, { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);

test("Android padding changes scroll with Reanimated UI refs represented as objects", () => {
  const reactions = [];
  const frames = [];
  const scrollCalls = [];
  const originalLoad = Module._load;
  const originalRaf = globalThis.requestAnimationFrame;
  let hook;
  try {
    Module._load = function (id, ...rest) {
      if (id === "react") return { useCallback: (callback) => callback };
      if (id === "react-native") return { Platform: { OS: "android" } };
      if (id === "react-native-reanimated") {
        return {
          scrollTo: (...args) => scrollCalls.push(args),
          useAnimatedReaction: (_prepare, react) => reactions.push(react),
        };
      }
      return originalLoad.call(this, id, ...rest);
    };
    const root = path.dirname(require.resolve("react-native-keyboard-controller/package.json"));
    hook = require(
      path.join(
        root,
        "lib/commonjs/components/KeyboardChatScrollView/useExtraContentPadding/index.js",
      ),
    ).useExtraContentPadding;
  } finally {
    Module._load = originalLoad;
  }
  const value = (data) => ({ value: data });
  const uiRef = { value: { nativeView: true } };
  try {
    globalThis.requestAnimationFrame = (callback) => frames.push(callback);
    hook({
      scrollViewRef: uiRef,
      extraContentPadding: value(40),
      keyboardPadding: value(0),
      blankSpace: value(0),
      scroll: value(0),
      layout: value({ height: 100, width: 100 }),
      size: value({ height: 100, width: 100 }),
      inverted: false,
      keyboardLiftBehavior: "whenAtEnd",
      freeze: value(false),
    });
    reactions[0](40, 0);
    assert.equal(frames.length, 1);
    frames[0](0);
    assert.deepEqual(scrollCalls, [[uiRef, 0, 40, false]]);
  } finally {
    globalThis.requestAnimationFrame = originalRaf;
  }
});
