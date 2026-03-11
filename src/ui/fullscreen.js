/** Get the current fullscreen target parent (fullscreen element or document.body) */
export function getFullscreenParent() {
  return document.fullscreenElement || document.webkitFullscreenElement || document.body;
}

/** Reparent an element into the current fullscreen context if needed */
export function reparentToFullscreen(el) {
  if (!el) return;
  const target = getFullscreenParent();
  if (el.parentElement !== target) {
    target.appendChild(el);
  }
}
