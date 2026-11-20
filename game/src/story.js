// story.js — the cast, the three jobs and every line of dialogue. Data only: missions.js runs the
// objectives, this file says who wants what and what it pays.

export const CAST = {
  dessy: { name: 'DESSY', colour: '#31e6ff', role: 'fixer' },
  marco: { name: 'MARCO', colour: '#ff5a4a', role: 'rival crew' },
  vance: { name: 'SGT. VANCE', colour: '#ffd45e', role: 'police' },
  rosa: { name: 'ROSA', colour: '#8bff9e', role: 'harbour master' },
  you: { name: 'YOU', colour: '#ffffff', role: 'wheelman' },
};

/**
 * Each mission: an id, a title, the money it pays, the people who talk, and an ordered list of
 * steps. A step is one objective the runtime watches: reach a marker, deliver the cargo, clear
 * the crew, or shake the cops.
 */
export const MISSIONS = {
  saltwater_run: {
    id: 'saltwater_run',
    index: 1,
    title: 'Saltwater Run',
    subtitle: 'Pick up the case, get it to the pier before it gets dark',
    reward: 1500,
    heat: 0,
    steps: [
      {
        kind: 'pickup',
        label: 'COLLECT THE CASE',
        hint: 'E · get in a car, then drive to the yellow marker',
        where: { x: -34, z: 118, r: 5 },
        dialogue: [
          { who: 'dessy', text: 'Case is in the lock-up on Ninth. Bring it to the pier, whole.' },
          { who: 'you', text: 'And if the pier has company?' },
          { who: 'dessy', text: "Then you're faster than they are. You are faster, aren't you?" },
        ],
      },
      {
        kind: 'deliver',
        label: 'DELIVER TO THE PIER',
        hint: 'Keep the car in one piece — the cargo does not like potholes',
        where: { x: 96, z: 322, r: 6 },
        timeLimit: 105,
        dialogue: [
          { who: 'dessy', text: "It's in the boot. Pier Nine, the blue container. Don't open it." },
          { who: 'you', text: 'Never do.' },
        ],
      },
    ],
    outro: [
      { who: 'dessy', text: 'Clean. There is more where that came from — and it pays better.' },
      { who: 'rosa', text: 'Tell Dessy the next one goes through me. The harbour has rules.' },
    ],
  },

  rival_crew: {
    id: 'rival_crew',
    index: 2,
    title: 'Bad Business',
    subtitle: 'Marco’s crew took the corner. Take it back.',
    reward: 2600,
    heat: 60,
    steps: [
      {
        kind: 'goto',
        label: 'GET TO THE CORNER',
        hint: 'Marco is in the alley behind the liquor store',
        where: { x: 178, z: -46, r: 9 },
        dialogue: [
          { who: 'dessy', text: "Marco's crew is on the corner of Ninth and Beacon. Five of them." },
          { who: 'you', text: 'Five is a lot of paperwork.' },
          { who: 'dessy', text: 'Four. I already counted one out.' },
        ],
      },
      {
        kind: 'wipeout',
        label: 'WIPE OUT THE RIVAL CREW',
        hint: 'Left click · fire   R · reload',
        count: 4,
        area: { x: 178, z: -46, r: 26 },
        dialogue: [
          { who: 'marco', text: 'You picked the wrong corner, friend.' },
          { who: 'you', text: 'You picked the wrong city.' },
        ],
      },
      {
        kind: 'escape',
        label: 'SHAKE THE RESPONSE',
        hint: 'Break line of sight — the stars fall on their own',
        heat: 3,
        dialogue: [
          { who: 'vance', text: 'Shots fired on Beacon. Every unit, move.' },
          { who: 'dessy', text: 'Get out of there. Do not let them box you in.' },
        ],
      },
    ],
    outro: [
      { who: 'dessy', text: 'Corner is ours again. Clean money, for a change.' },
      { who: 'vance', text: 'I know the car. I will find the driver.' },
    ],
  },

  harbour_escape: {
    id: 'harbour_escape',
    index: 3,
    title: 'Harbour Lights',
    subtitle: 'Get the loaded car onto the barge before the tide',
    reward: 4200,
    heat: 120,
    steps: [
      {
        kind: 'pickup',
        label: 'TAKE THE LOADED CAR',
        hint: 'The car is parked on the strip — get in and drive',
        where: { x: -198, z: 300, r: 6 },
        dialogue: [
          { who: 'rosa', text: 'One car, one barge, eleven minutes. After that the tide takes it.' },
          { who: 'you', text: 'And the police?' },
          { who: 'rosa', text: 'They take their coffee at the pier. Mostly.' },
        ],
      },
      {
        kind: 'deliver',
        label: 'REACH THE BARGE',
        hint: 'Three stars minimum — they will try to stop you',
        where: { x: 268, z: 300, r: 7 },
        timeLimit: 130,
        dialogue: [
          { who: 'vance', text: 'That car is flagged. Roadblock on the boulevard.' },
          { who: 'dessy', text: 'Keep moving. Do not stop for anything — not even a red.' },
        ],
      },
      {
        kind: 'escape',
        label: 'LOSE THEM BEFORE THE TIDE',
        hint: 'Get clear of the harbour and let the stars burn down',
        heat: 4,
        dialogue: [
          { who: 'rosa', text: 'Load is aboard. Go be somebody else for a week.' },
        ],
      },
    ],
    outro: [
      { who: 'rosa', text: 'Tide is in, the barge is gone, and you are still breathing. Good night.' },
      { who: 'dessy', text: 'That is the whole city, then. Rest. Truly.' },
    ],
  },
};

export const MISSION_ORDER = ['saltwater_run', 'rival_crew', 'harbour_escape'];

/** The line to show when a mission starts, as a banner pair. */
export function missionIntro(id) {
  const mission = MISSIONS[id];
  if (!mission) return null;
  return mission.steps[0].dialogue ?? null;
}

/** Who is next in the chain, or null when the story is finished. */
export function nextMissionId(id) {
  const i = MISSION_ORDER.indexOf(id);
  if (i < 0 || i + 1 >= MISSION_ORDER.length) return null;
  return MISSION_ORDER[i + 1];
}

/** A friendly title for the HUD's job counter: "JOB 2 OF 3 · BAD BUSINESS". */
export function jobLabel(id) {
  const mission = MISSIONS[id];
  if (!mission) return 'NO JOB — LOOK FOR A MARKER';
  return `JOB ${mission.index} OF ${MISSION_ORDER.length} · ${mission.title.toUpperCase()}`;
}

/** Where each mission's marker stands before it starts. */
export const MISSION_STARTS = {
  saltwater_run: { x: -34, z: 118, name: 'SALTWATER RUN' },
  rival_crew: { x: 178, z: -46, name: 'BAD BUSINESS' },
  harbour_escape: { x: -198, z: 300, name: 'HARBOUR LIGHTS' },
};
