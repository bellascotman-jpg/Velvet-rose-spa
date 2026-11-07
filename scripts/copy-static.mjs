import { mkdir, copyFile } from "node:fs/promises";

await mkdir("public", { recursive: true });
await copyFile("index.html", "public/index.html");
console.log("Prepared the uploaded standalone HTML in public/.");
