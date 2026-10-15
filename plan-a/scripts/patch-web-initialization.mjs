import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "scratch/asar/webview"),
  assets = path.join(web, "assets");
const initial = path.join(assets, "app-initial-236e1501144c.js");
let source = await fs.readFile(initial, "utf8");
function replaceOnce(source, before, after) {
  if (source.split(before).length !== 2)
    throw Error("Pinned initialization anchor changed: " + before.slice(0, 80));
  return source.replace(before, after);
}
if (!source.includes("__CODEX_WEB_LAZY_TOOLS_V18__")) {
  for (const [before, after] of [
    ["yCa=t(()=>{Bx(),gCa(),T1t(),", "yCa=t(()=>{Bx(),T1t(),"],
    [
      "async canCallTool(e){return lCa(S1t(),e)}",
      "async canCallTool(e){gCa();return lCa(S1t(),e)}",
    ],
    [
      "async cancelToolCall(e){dCa(e)}",
      "async cancelToolCall(e){gCa();dCa(e)}",
    ],
    [
      "async dispatchToolCall(e){return uCa(S1t(),e)}",
      "async dispatchToolCall(e){gCa();return uCa(S1t(),e)}",
    ],
  ])
    source = replaceOnce(source, before, after);
  await fs.writeFile(
    initial,
    "var __CODEX_WEB_LAZY_TOOLS_V18__=true;\n" + source,
  );
}
const primary = path.join(assets, "app-primary-6b28e06666ff.js");
source = await fs.readFile(primary, "utf8");
if (!source.includes("__CODEX_WEB_LAZY_MAP_V18__")) {
  const begin = source.indexOf("bZn=i((e,t)=>{Kg(),"),
    end = source.indexOf(",xZn,SZn=t(", begin);
  if (begin < 0 || end < 0) throw Error("Pinned map engine factory changed");
  const declaration = source.slice(begin, end),
    factory = declaration.slice("bZn=i(".length, -1);
  const mapSource =
    'import{Pun as Kg}from"./app-initial-236e1501144c.js";const e={},t={exports:e};(' +
    factory +
    ")(e,t);export default t.exports;\n";
  const name =
    "mapbox-runtime-web-" +
    createHash("sha256").update(mapSource).digest("hex").slice(0, 12) +
    ".js";
  await fs.writeFile(path.join(assets, name), mapSource);
  source = source.slice(0, begin) + source.slice(end + 1);
  source = replaceOnce(source, "h0=n(bZn(),1)", "h0=void 0");
  const start = source.indexOf("function DZn(e){"),
    stop = source.indexOf("function OZn(", start);
  if (start < 0 || stop < 0) throw Error("Pinned map component changed");
  let component = source.slice(start, stop);
  component = replaceOnce(
    component,
    "c=()=>s()",
    `c=()=>{if(h0)return s();let stopped=false,cleanup;import("./${name}").then(module=>{if(stopped)return;h0={default:module.default};cleanup=s()}).catch(error=>console.error("Map initialization failed",error));return()=>{stopped=true;cleanup?.()}}`,
  );
  source = source.slice(0, start) + component + source.slice(stop);
  await fs.writeFile(
    primary,
    "var __CODEX_WEB_LAZY_MAP_V18__=true;\n" + source,
  );
  console.log(
    "Map engine moved to on-demand module:",
    name,
    Buffer.byteLength(mapSource),
  );
}
try {
  await fs.lstat(path.join(web, "assets-init-v18"));
} catch {
  await fs.symlink("assets", path.join(web, "assets-init-v18"));
}
const html = path.join(web, "index.html");
await fs.writeFile(
  html,
  (await fs.readFile(html, "utf8"))
    .replaceAll("./assets-send-v16/", "./assets-init-v18/")
    .replaceAll("./assets-startup-v14/", "./assets-init-v18/")
    .replaceAll("./assets-startup-v17/", "./assets-init-v18/")
    .replaceAll("./assets/", "./assets-init-v18/"),
);
console.log("Web tool handlers and map engine initialize on demand");
