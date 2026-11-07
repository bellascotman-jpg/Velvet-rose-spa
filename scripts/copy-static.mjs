import { mkdir, copyFile } from "node:fs/promises";

await mkdir("public", { recursive: true });
for (const file of ["index.html", "payment-return.html"]) {
  await copyFile(file, `public/${file}`);
}
console.log("Prepared the Velvet Rose site and Paystack return page in public/.");
