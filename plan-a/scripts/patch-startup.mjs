import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { minify } from "rolldown/utils";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webview = path.join(root, "scratch/asar/webview");
const assets = path.join(webview, "assets");
const initial = path.join(assets, "app-initial-236e1501144c.js");
let source = await fs.readFile(initial, "utf8");
if (!source.includes("loadStatsigBootstrap")) {
  const begin = source.indexOf("function QUo(e) {");
  const end = source.indexOf("function $Uo(e, t) {", begin);
  if (begin < 0 || end < 0)
    throw Error("Pinned Statsig bootstrap component changed");
  let component = source.slice(begin, end);
  const replace = (before, after) => {
    if (component.split(before).length !== 2)
      throw Error("Statsig startup patch anchor changed");
    component = component.replace(before, after);
  };
  replace("(0, K3.c)(44)", "(0, K3.c)(45)");
  replace(
    "t[0] !== p || t[1] !== l",
    "t[0] !== p || t[1] !== l || t[44] !== i",
  );
  replace(
    "let t = await cUo(e);",
    "let t = await (window.__ELECTRON_SHIM__?.loadStatsigBootstrap ? window.__ELECTRON_SHIM__.loadStatsigBootstrap(e, { auth: i, sdkKey: l }, () => cUo(e)) : cUo(e));",
  );
  replace(
    "sUo(e.initializeSync(), `electron`),",
    "sUo(e.initializeSync(), `electron`),\n            window.__ELECTRON_SHIM__?.refreshStatsigBootstrap?.(e, t),",
  );
  replace(
    "(t[1] = l),\n      (t[2] = g)",
    "(t[1] = l),\n      (t[44] = i),\n      (t[2] = g)",
  );
  source = source.slice(0, begin) + component + source.slice(end);
  await fs.writeFile(initial, source);
}
for (const name of [
  "app-initial-236e1501144c.js",
  "app-primary-6b28e06666ff.js",
]) {
  const file = path.join(assets, name);
  const code = await fs.readFile(file, "utf8");
  const result = await minify(name, code, {
    module: true,
    compress: false,
    mangle: false,
  });
  if (result.errors.length)
    throw Error("Could not minify startup script: " + name);
  await fs.writeFile(file, result.code);
}
// Download the main UI bundle during initial script/RPC initialization.
const primaryName = "app-primary-6b28e06666ff.js";
const primaryPreload = `<link rel="modulepreload" crossorigin href="./assets/${primaryName}" />`;
const htmlFile = path.join(webview, "index.html");
const currentHtml = await fs.readFile(htmlFile, "utf8");
if (
  !currentHtml.includes(`href="./assets-startup-v17/${primaryName}"`) &&
  !currentHtml.includes(`href="./assets-send-v16/${primaryName}"`) &&
  !currentHtml.includes(primaryPreload)
) {
  await fs.access(path.join(assets, primaryName));
  await fs.writeFile(
    htmlFile,
    currentHtml.replace("</head>", `${primaryPreload}\n</head>`),
  );
}

// A new URL namespace keeps existing immutable browser caches valid.
const alias = path.join(webview, "assets-startup-v14");
try {
  await fs.lstat(alias);
} catch {
  await fs.symlink("assets", alias);
}
const htmlPath = path.join(webview, "index.html");
const html = await fs.readFile(htmlPath, "utf8");
await fs.writeFile(
  htmlPath,
  html
    .replaceAll("./assets/", "./assets-startup-v14/")
    .replaceAll("./assets-startup-v13/", "./assets-startup-v14/")
    .replaceAll("./assets-startup-v17/", "./assets-startup-v14/"),
);
const nativeMain = path.join(root, "scratch/asar/.vite/build/main-C5K7o1Hr.js");
let nativeSource = await fs.readFile(nativeMain, "utf8");
if (!nativeSource.includes("__CODEX_WEB_STARTUP_FETCH__")) {
  const anchor = "    e.once(`destroyed`, () => h[Symbol.dispose]());";
  if (nativeSource.split(anchor).length !== 2)
    throw Error("Pinned HTTP service anchor changed");
  nativeSource = nativeSource.replace(
    anchor,
    "    globalThis.__CODEX_WEB_STARTUP_FETCH__ = (params, signal) => this.fetchWrapper.fetchAuthenticatedJson(`/wham/statsig/bootstrap`, { method: `POST`, body: params, signal });\\n".replace(
      "\\n",
      "\n",
    ) + anchor,
  );
  await fs.writeFile(nativeMain, nativeSource);
}
console.log("Startup configuration cache and compact scripts prepared");
