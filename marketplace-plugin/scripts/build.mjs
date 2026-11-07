import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const options = { absWorkingDir: root, bundle: true, minify: true, target: "es2022", platform: "browser" };
const bridge = await build({ ...options, entryPoints: ["src/presentation-bridge.mjs"],
  format: "iife", globalName: "WillhabenMcpApps", conditions: ["browser"], write: false });
const source = bridge.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
await mkdir(root + "src/generated", { recursive: true });
await writeFile(root + "src/generated/presentation-bridge.mjs",
  "export const PRESENTATION_BRIDGE_SOURCE = " + JSON.stringify(source) + ";\n");

if (!process.argv.includes("--bridge-only")) {
  await build({ ...options, entryPoints: ["src/index.mjs"], outfile: "dist/index.mjs",
    format: "esm", conditions: ["workerd", "browser"], external: ["cloudflare:*"] });
}
