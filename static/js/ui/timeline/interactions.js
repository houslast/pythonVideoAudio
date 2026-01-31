import { bindDropSounds } from "./interactions/drop.js";
import { bindKeyboard } from "./interactions/keyboard.js";
import { bindMouse } from "./interactions/mouse.js";
import { bindVideoPlayback } from "./interactions/video.js";

export function bindTimelineInteractions(opts) {
  bindDropSounds(opts);
  bindMouse(opts);
  bindKeyboard(opts);
  bindVideoPlayback(opts);
}

