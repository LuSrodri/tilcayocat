// A short "hands off" window after every abrupt screen change (a results card popping up, a
// panel switching, a sheet opening), so a tap meant for the game doesn't land on a button.
export const UI_GUARD_MS = 1250;

let until = 0;

export function isGuarded(): boolean {
  return performance.now() < until;
}

/** Block clicks inside `root` for a moment and show a filling bar on its buttons. */
export function guard(root: HTMLElement, ms = UI_GUARD_MS): void {
  until = Math.max(until, performance.now() + ms);
  window.clearTimeout(Number(root.dataset.guardTimer));
  root.style.setProperty("--guard-ms", `${ms}ms`);
  root.classList.remove("is-guarded");
  void root.offsetWidth;
  root.classList.add("is-guarded");
  const id = window.setTimeout(() => root.classList.remove("is-guarded"), ms);
  root.dataset.guardTimer = String(id);
  if (!root.dataset.guardBound) {
    root.dataset.guardBound = "1";
    // capture phase: keyboard-activated clicks are swallowed too
    root.addEventListener(
      "click",
      (ev) => {
        if (root.classList.contains("is-guarded")) {
          ev.preventDefault();
          ev.stopImmediatePropagation();
        }
      },
      true
    );
  }
}
