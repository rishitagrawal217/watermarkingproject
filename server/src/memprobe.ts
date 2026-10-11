/** Child-process probe: peak RSS growth of ONE embed or extract call (V8 heap + native buffers).
 *  usage: node --import tsx src/memprobe.ts <method> <embed|extract> <png-in> */
import { deriveKeys } from "./core/keys.js";
import { decodeGray, makeLogo, randomBytes } from "./core/dataset.js";
import { KEY, MethodName, buildMethods } from "./methods.js";

const [method, phase, file] = process.argv.slice(2);
const deltas = JSON.parse(process.env.DELTAS ?? '{"DCT":60,"DWT2":25}');
const m = buildMethods(makeLogo(), deltas, randomBytes(1024, 2026))[method as MethodName];
const img = await decodeGray((await import("node:fs")).readFileSync(file));
deriveKeys(KEY);
const rss = () => process.resourceUsage().maxRSS / 1024; // kB -> MiB
const base = rss();
if (phase === "embed") m.embed(img, 0); else m.extract(img, 0);
console.log(JSON.stringify({ peakGrowthMiB: Math.max(0, rss() - base) }));
