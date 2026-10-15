import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const file=path.join(root,"scratch/asar/webview/assets/app-initial-236e1501144c.js");
let source=await fs.readFile(file,"utf8");
const start=source.indexOf("function cRr(e,t,n){"),end=source.indexOf("async function lRr(",start);
if(start<0||end<0)throw Error("Pinned plugin catalog hook changed");
let body=source.slice(start,end);
const patches=[
 ["u=n?.includeRemoteCatalog??!0","u=n?.includeRemoteCatalog??(window.__ELECTRON_SHIM__?!1:!0)"],
 ["includeVerticalCatalog:n?.includeRemoteCatalog!==!1&&!c&&", "includeVerticalCatalog:u&&!c&&"],
];
for(const[before,after]of patches){
 if(body.includes(after))continue;
 if(body.split(before).length!==2)throw Error("Plugin catalog default anchor changed");
 body=body.replace(before,after);
}
await fs.writeFile(file,source.slice(0,start)+body+source.slice(end));
console.log("Ordinary web chat loads the local catalog; explicit remote catalog requests stay enabled");
