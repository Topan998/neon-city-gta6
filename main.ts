// Neon City's hand-in: one Node 22 script, standard library only, no build and no install.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// Two steps. Stage copies game/ and screenshots/ into the output directory (default /output, or
// whatever MAKEFUN_OUTPUT_DIR says) after deleting the copies an earlier run left there, so the
// judge never sees a file the repository no longer has. Serialize then hands that staged
// directory to buildDossier from vendor/makefun-game.ts, which walks it once and writes
// dossier.json: the game's sources in load order as fenced text, the screenshots as base64 with
// their sha256.
//
// The limits below are the gate's own, copied from its gate.json. Passing them to buildDossier
// makes this program exactly as strict as the scorer: an entry it would refuse throws here, with
// the offending cap named, instead of shipping quietly and being dropped later.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** The repository root: this file's own directory, the parent of game/ and screenshots/. */
const here = fileURLToPath(new URL('.', import.meta.url));

/** Where the hand-in lands. The kit exports MAKEFUN_OUTPUT_DIR; /output stands in when it does not. */
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The gate's caps for gta6-01, verbatim: the bytes one text may take, screenshots and their sizes,
 *  and how much game/ may hold (files+dirs, bytes, one path's length). */
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

/** One file under a staged directory: its absolute path and its size in bytes. */
interface Staged {
  path: string;
  bytes: number;
}

/** Every regular file below `dir`, depth first. Directories themselves count as nothing here. */
function walk(dir: string): Staged[] {
  const found: Staged[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile()) found.push({ path, bytes: statSync(path).size });
  }
  return found;
}

/** Sum of sizes, for the one-line totals. */
const bytesOf = (files: Staged[]): number => files.reduce((n, f) => n + f.bytes, 0);

/** KiB with one decimal, the unit the dossier's own header is quoted in. */
const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;

/**
 * Copy one of the entry's two directories into the output directory, over nothing: an old copy is
 * removed first. Returns false when the repository has no such directory (screenshots/ is allowed
 * to be missing here; buildDossier refuses the entry later if it still is).
 */
function stage(name: 'game' | 'screenshots'): boolean {
  const from = join(here, name);
  if (!existsSync(from)) return false;
  const to = join(outDir, name);
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  return true;
}

mkdirSync(outDir, { recursive: true });
stage('game');
stage('screenshots');

// The screenshots, held to the gate before anything is written: at most four, each under 256 KiB
// and each a PNG or a JPEG, which buildDossier checks by its first bytes.
const shotsDir = join(outDir, 'screenshots');
const shots = existsSync(shotsDir) ? readdirSync(shotsDir).sort() : [];
if (shots.length > CAPS.screenshots.max) {
  throw new Error(`screenshots/: ${shots.length} files, the gate takes ${CAPS.screenshots.max} at most`);
}
for (const name of shots) {
  const bytes = statSync(join(shotsDir, name)).size;
  if (bytes > CAPS.screenshots.max_bytes) {
    throw new Error(`screenshots/${name}: ${bytes} bytes, one image may be ${CAPS.screenshots.max_bytes}`);
  }
}

// The dossier is built from the staged copy, not from the repository, so its bytes describe
// exactly what the judge is handed.
const dossier = buildDossier(outDir, CAPS);
writeFileSync(join(outDir, 'dossier.json'), dossier);

// A short account of the run: what was copied, how many renders ride along, how big the dossier is.
const game = walk(join(outDir, 'game'));
const shotBytes = bytesOf(shots.map((name) => ({ path: join(shotsDir, name), bytes: statSync(join(shotsDir, name)).size })));

console.log(`Neon City handed in to ${outDir}`);
console.log(`  game        ${game.length} files, ${bytesOf(game)} B (${kib(bytesOf(game))})`);
console.log(`  screenshots ${shots.length} images, ${shotBytes} B (${kib(shotBytes)})`);
console.log(`  dossier     ${dossier.length} B (${kib(dossier.length)})`);
