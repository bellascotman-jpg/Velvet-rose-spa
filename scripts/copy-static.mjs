import { mkdir, copyFile } from "node:fs/promises";

const files = ["index.html", "styles.css", "config.js", "app.js"];
await mkdir("public", { recursive: true });
for (const file of files) {
  await copyFile(file, `public/${file}`);
}
console.log(`Prepared ${files.length} static files in public/.`);
