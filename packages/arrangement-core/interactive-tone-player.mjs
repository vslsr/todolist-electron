/*! interactive-tone-player — native ESM entry (re-exports the UMD build). */
import * as ns from './interactive-tone-player.js';

const M =
  (ns && ns.default && ns.default.InteractiveMusicPlayer) ? ns.default :
  (ns && ns.InteractiveMusicPlayer) ? ns :
  (typeof globalThis !== 'undefined' ? globalThis.ArrangementInteractivePlayer : undefined);

if (!M || !M.InteractiveMusicPlayer) {
  throw new Error('interactive-tone-player: failed to load implementation from ./interactive-tone-player.js');
}

export const InteractiveMusicPlayer = M.InteractiveMusicPlayer;
export default M;
