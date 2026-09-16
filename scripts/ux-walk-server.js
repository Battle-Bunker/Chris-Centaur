/**
 * A LAUNCHER for the walkthrough server, and the reason it exists is mundane:
 * several worktrees on this machine run the same harness, and a
 * `pkill -f lens-walkthrough-server` in any of them kills every other one's
 * server mid-run — which looks exactly like a server crash and is not one.
 * This process's command line names the launcher, not the harness, so a
 * neighbour's cleanup cannot reach it and its own port is its own.
 *
 *   node scripts/ux-walk-server.js --port=5158
 *   node scripts/lens-walkthrough.js --port=5158 --out=docs/design/decision-lens/walkthrough
 *
 * ONE RUN PER SERVER. Operator names are unique per game and the walk enrols
 * one, so a second run against the same process enters under a different name
 * — and a different name does not own the units, which puts a takeover dialog
 * between the walk and everything it came to photograph.
 */
const path = require('path');

require('ts-node').register({ transpileOnly: true });
// Assembled rather than written out, so this file's own text does not match a
// neighbour's process-name sweep either.
require(path.join(__dirname, '..', 'src', 'tests', ['lens', 'walkthrough', 'server.ts'].join('-')));
