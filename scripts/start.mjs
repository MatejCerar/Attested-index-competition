// One command to run the whole demo: the local API server (scripts/server.mjs,
// :8787) and the Vite dev server (app, :3000) together. Pipes both outputs and
// shuts both down on Ctrl-C. No heavy deps: just child_process.spawn.
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

function run(name, cmd, args, opts = {}) {
    const child = spawn(cmd, args, {cwd: root, env: process.env, ...opts});
    const tag = `[${name}]`;
    const pipe = (stream, w) =>
        stream.on("data", (d) =>
            String(d)
                .split("\n")
                .filter((l) => l.length)
                .forEach((l) => w(`${tag} ${l}`))
        );
    pipe(child.stdout, console.log);
    pipe(child.stderr, console.error);
    child.on("exit", (code) => {
        console.log(`${tag} exited (${code})`);
        shutdown();
    });
    return child;
}

const children = [];
let shuttingDown = false;
function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    for (const c of children) c.kill("SIGTERM");
    setTimeout(() => process.exit(0), 200);
}

console.log("Starting index-competition demo:");
console.log("  API  http://localhost:8787");
console.log("  App  http://localhost:3000  (open /build)");
console.log("");

children.push(run("api", process.execPath, [join(__dirname, "server.mjs")]));
children.push(run("app", "npm", ["--prefix", "app", "run", "dev"]));

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
