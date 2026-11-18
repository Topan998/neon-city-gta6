// three-shim.js — one place where the vendored classic build is picked up as a module.
// index.html loads vendor/three.min.js as a plain script, so THREE is on the global before any
// module of the game runs; this re-export keeps the import graph honest for every other module.
const THREE = globalThis.THREE;
if (!THREE) throw new Error('three.js was not loaded before the game modules');

export default THREE;
export { THREE };
