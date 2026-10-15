import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.dirname(require.resolve("react-native-keyboard-controller/package.json"));
const files = [
  "src/components/KeyboardChatScrollView/useExtraContentPadding/index.ts",
  "lib/commonjs/components/KeyboardChatScrollView/useExtraContentPadding/index.js",
  "lib/module/components/KeyboardChatScrollView/useExtraContentPadding/index.js",
];

for (const relative of files) {
  const file = path.join(root, relative);
  const before = fs.readFileSync(file, "utf8");
  // Reanimated 4.7 maps refs to objects on the UI runtime. scrollTo already
  // validates the native reference, so the older callable-ref check is redundant.
  const after = before.replace(
    /[ \t]*\/\/ check that view is still mounted and ref is actual\r?\n[ \t]*\/\/ otherwise it may lead to a crash\r?\n[ \t]*if \(!scrollViewRef\(\)\) \{\r?\n[ \t]*return;\r?\n[ \t]*\}\r?\n/,
    "",
  );
  if (after === before) continue;
  const temporary = file + ".patch.tmp";
  fs.writeFileSync(temporary, after);
  fs.renameSync(temporary, file);
}
