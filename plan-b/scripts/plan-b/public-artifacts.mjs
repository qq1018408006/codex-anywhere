import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve, join } from "node:path";

const require = createRequire(import.meta.url);
const QRCode = require("qrcode-terminal/vendor/QRCode");
const levels = require("qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel");
const repo = resolve(import.meta.dirname, "../..");
const artifacts = resolve(repo, "../artifacts");
const state = JSON.parse(
  await readFile(
    join(homedir(), ".local/share/codex-relay-b/relay-state/server-state.json"),
    "utf8",
  ),
);
const qr = new QRCode(-1, levels.M);
qr.addData(state.pairingPayload);
qr.make();
const count = qr.getModuleCount();
const edge = count + 8;
const modules = [];
for (let row = 0; row < count; row++) {
  for (let column = 0; column < count; column++) {
    if (qr.isDark(row, column)) modules.push(`M${column + 4} ${row + 4}h1v1h-1z`);
  }
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${edge} ${edge}" width="560" height="560" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><path d="${modules.join("")}" fill="black"/></svg>`;
const escape = (value) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
await mkdir(artifacts, { recursive: true });
await writeFile(join(artifacts, "pairing.svg"), svg);
await writeFile(
  join(artifacts, "index.html"),
  `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Codex Relay B</title>
<style>body{font:18px/1.6 system-ui;max-width:720px;margin:32px auto;padding:0 20px;color:#222}img{max-width:100%;height:auto}a{color:#1455ad}code{background:#eee;padding:3px 6px}li{margin:12px 0}</style>
<h1>Codex Relay B</h1>
<p><a href="codex-relay-b-arm64.apk" download>下载 Android ARM64 APK</a> · <a href="SHA256SUMS">校验文件</a></p>
<ol><li>手机与电脑连接同一局域网，安装 APK，打开 <b>Codex Relay B</b>。</li>
<li>在电脑浏览器打开此页，用应用内的扫码功能扫描下方二维码；手机上也可尝试 <a href="${escape(state.pairingPayload)}">打开配对链接</a>。</li>
<li>应用显示配对码后，在电脑运行 <code>codex-relay-b approve XXXX-XXXX</code>，将示例替换成实际配对码。</li>
<li>在电脑或这台主机的 SSH 终端运行 <code>codex-b</code>，然后在手机会话列表打开同一会话。</li></ol>
<p>手机创建的会话可用 <code>codex-b resume</code> 选择，或用 <code>codex-b resume &lt;会话 ID&gt;</code> 接入。普通 <code>codex</code> 与 Plan A 继续独立使用。</p>
<img src="pairing.svg" alt="Plan B 配对二维码">
<p>连接地址：${escape(state.connectUrl)}</p>
</html>`,
);
console.log(`Public pairing and APK page: ${join(artifacts, "index.html")}`);
