// Neon City's hand-in, in one Node 22 script (no build step, no install):
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
//
// It does two things. First it stages the entry — game/ and screenshots/ — into the output
// directory, starting from an empty one so a file left over from an earlier run can never end up
// in the hand-in. Then it hands that staged directory to vendor/makefun-game.ts, which walks the
// files and serializes them into dossier.json: the game's source in import order, plus the
// screenshots base64'd with their hashes.
//
// The numbers passed to buildDossier are the gate's own, so this program is as strict as the
// scorer: a payload the gate would refuse throws here and names the file, instead of leaving a
// run that looked fine and an entry that gets dropped.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

/** Where this file sits: the repository root, the parent of game/ and screenshots/. */
const here = fileURLToPath(new URL('.', import.meta.url));

/** The directory the judge reads. The kit sets MAKEFUN_OUTPUT_DIR; /output is the default. */
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** The gate's caps for best-game-01 / gta6-01, copied from its gate.json. */
const CAPS = {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
} as const;

/** Every regular file under `dir`, with its size, counting subdirectories as we go. */
function listFiles(dir: string): { path: string; bytes: number }[] {
  const files: { path: string; bytes: number }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(path));
    else if (entry.isFile()) files.push({ path, bytes: statSync(path).size });
  }
  return files;
}

/** Bytes across a list of files, for the summary line. */
const totalBytes = (files: { bytes: number }[]): number =>
  files.reduce((sum, file) => sum + file.bytes, 0);

/** Sizes in KiB, the unit the dossier is quoted in. */
const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;

mkdirSync(outDir, { recursive: true });

// A clean stage: anything the last run left under these two names goes first.
for (const name of ['game', 'screenshots']) {
  rmSync(join(outDir, name), { recursive: true, force: true });
}

// The payload. screenshots/ is optional at the filesystem level; buildDossier insists on it later.
cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// Refuse a screenshot set the scorer would drop, and say which file broke the rule.
const shotsDir = join(outDir, 'screenshots');
const shots = existsSync(shotsDir) ? readdirSync(shotsDir) : [];
if (shots.length > CAPS.screenshots.max) {
  throw new Error(
    `${shots.length} screenshots in ${shotsDir}: the gate takes at most ${CAPS.screenshots.max}`,
  );
}
for (const name of shots) {
  const bytes = statSync(join(shotsDir, name)).size;
  if (bytes > CAPS.screenshots.max_bytes) {
    throw new Error(
      `screenshots/${name} is ${bytes} bytes: the gate caps one screenshot at ${CAPS.screenshots.max_bytes}`,
    );
  }
}

// Build the dossier from the staged copy, not from the source tree: what goes in the file is then
// exactly what the judge is handed.
const dossier = buildDossier(outDir, CAPS);
writeFileSync(join(outDir, 'dossier.json'), dossier);

const gameFiles = listFiles(join(outDir, 'game'));
const shotBytes = shots.reduce((sum, name) => sum + statSync(join(shotsDir, name)).size, 0);

// Say what was written, so a run explains itself without anyone having to go and look.
console.log(`Neon City handed in to ${outDir}`);
console.log(`  game/         ${gameFiles.length} files, ${totalBytes(gameFiles)} bytes (${kib(totalBytes(gameFiles))})`);
console.log(`  screenshots/  ${shots.length} images, ${shotBytes} bytes (${kib(shotBytes)})`);
console.log(`  dossier.json  ${dossier.length} bytes (${kib(dossier.length)})`);

// The game's own files, one per line, so a missing module is visible at a glance.
for (const file of gameFiles) {
  console.log(`    game/${file.path.slice(join(outDir, 'game').length + 1)}  ${file.bytes} B`);
}
