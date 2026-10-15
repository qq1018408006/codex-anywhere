import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const web=path.join(root,"scratch/asar/webview");
try { await fs.lstat(path.join(web,"assets-send-v16")); }
catch { await fs.symlink("assets",path.join(web,"assets-send-v16")); }
const html=path.join(web,"index.html");
await fs.writeFile(html,(await fs.readFile(html,"utf8"))
 .replaceAll("./assets-startup-v14/","./assets-send-v16/")
 .replaceAll("./assets-submit-v15/","./assets-send-v16/"));
