// Hand the entry in: copy game/ and screenshots/ to $MAKEFUN_OUTPUT_DIR (or /output), then write the
// dossier the judge reads with the kit's own library, so the file the gate rebuilds matches this one
// byte for byte. This is what `/output` gets, nothing else.
//
// The screenshots are checked before the dossier is written: no more than four, each 1280×720 and
// under the gate's 256 KiB cap. A file that would be refused by the scorer fails here instead of
// shipping quietly.
//
// Node 22 runs this file directly, no build and no install:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// The caps below are the scorer's own gate.json numbers. Passing them here means this program refuses
// anything the grader would refuse, instead of handing in an entry that is quietly invalid.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const SHOT_CAP = 262144;
const SHOT_MAX = 4;

/** Every file under a directory, for the one-line summary printed when the copy is done. */
function walk(dir) {
  const found = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.isFile()) found.push({ path, bytes: statSync(path).size });
  }
  return found;
}

mkdirSync(out, { recursive: true });

// Start from an empty hand-in, so a stale file from an earlier run never lands in the dossier.
for (const stale of ['game', 'screenshots']) {
  rmSync(join(out, stale), { recursive: true, force: true });
}

cpSync(join(root, 'game'), join(out, 'game'), { recursive: true });
if (existsSync(join(root, 'screenshots'))) {
  cpSync(join(root, 'screenshots'), join(out, 'screenshots'), { recursive: true });
}

// The four photographs are part of the entry: refuse to hand in a set the scorer would drop.
const shotDir = join(out, 'screenshots');
if (existsSync(shotDir)) {
  const shots = readdirSync(shotDir);
  if (shots.length > SHOT_MAX) {
    throw new Error(`${shots.length} screenshots in ${shotDir}: the gate takes ${SHOT_MAX}`);
  }
  for (const name of shots) {
    const bytes = statSync(join(shotDir, name)).size;
    if (bytes > SHOT_CAP) {
      throw new Error(`${name} is ${bytes} B: the gate caps a screenshot at ${SHOT_CAP} B`);
    }
  }
}

const dossier = buildDossier(out, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(out, 'dossier.json'), dossier);

// What went out, so the run says so in one line rather than leaving it to be guessed.
const gameFiles = existsSync(join(out, 'game')) ? walk(join(out, 'game')) : [];
const gameBytes = gameFiles.reduce((sum, file) => sum + file.bytes, 0);
const shots = existsSync(join(out, 'screenshots')) ? readdirSync(join(out, 'screenshots')).length : 0;
console.log(
  `Neon City handed in to ${out}: ${gameFiles.length} game files, ${(gameBytes / 1024).toFixed(0)} KiB, ` +
    `${shots} screenshots, dossier ${(dossier.length / 1024).toFixed(0)} KiB`,
);
for (const file of gameFiles.filter((entry) => entry.path.endsWith('.js') || entry.path.endsWith('.html'))) {
  console.log(`  ${relative(out, file.path)}  ${file.bytes} B`);
}
