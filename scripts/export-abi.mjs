// Regenerate scripts/abi/<Name>.json ({abi, bytecode}) from forge build output
// (out/<Name>.sol/<Name>.json). Run after `forge build` whenever a contract the
// deploy pipeline uses changes:
//   forge build && node scripts/export-abi.mjs
import {readFileSync, writeFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "out");
const abiDir = join(__dirname, "abi");

// Contracts the deploy pipeline (compete-setup + server) instantiates.
const NAMES = [
    "MockUSDC",
    "MockUniswapV3Pool",
    "IndexShareVault",
    "VaultFactory",
    "StableIndexVault", // legacy, kept for backward compatibility
];

for (const name of NAMES) {
    const src = join(outDir, `${name}.sol`, `${name}.json`);
    let art;
    try {
        art = JSON.parse(readFileSync(src, "utf8"));
    } catch {
        console.error(`skip ${name}: ${src} not found (did forge build run?)`);
        continue;
    }
    const bytecode =
        typeof art.bytecode === "string" ? art.bytecode : art.bytecode?.object;
    if (!art.abi || !bytecode) {
        console.error(`skip ${name}: missing abi/bytecode in artifact`);
        continue;
    }
    const dst = join(abiDir, `${name}.json`);
    writeFileSync(dst, JSON.stringify({abi: art.abi, bytecode}, null, 0) + "\n");
    console.log(`wrote scripts/abi/${name}.json (${art.abi.length} abi entries)`);
}
