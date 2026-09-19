// Hole DOM shared by the solo game and the 1v1 arena.

export const MOUSE_IMG =
  `<picture><source srcset="/img/mouse.webp" type="image/webp">` +
  `<img src="/img/mouse.png" alt="" width="420" height="645" draggable="false" decoding="async"></picture>`;

export const PAW_IMG =
  `<picture><source srcset="/img/paw.webp" type="image/webp">` +
  `<img src="/img/paw.png" alt="" width="520" height="612" draggable="false" decoding="async"></picture>`;

export function createHoleEl(index: number): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "hole";
  el.setAttribute("aria-label", `Mouse hole ${index + 1}`);
  el.innerHTML =
    `<span class="hole__back"></span>` +
    `<span class="hole__clip">` +
    `<span class="hole__mouse">${MOUSE_IMG}</span>` +
    `<span class="hole__power"><span class="hole__power-img"></span></span>` +
    `</span>` +
    `<span class="hole__front"></span>` +
    `<span class="hole__flash" aria-hidden="true"></span>` +
    `<span class="hole__pawshadow" aria-hidden="true"></span>` +
    `<span class="hole__paw" aria-hidden="true">${PAW_IMG}</span>` +
    `<span class="hole__pop" aria-hidden="true">+1</span>`;
  return el;
}

// Paw slap + floating label on a hole; extra classes drive the variant.
export function burst(el: HTMLElement, classes: string, label: string, ms: number): void {
  const list = classes.split(" ").filter(Boolean);
  el.classList.remove("is-hit", ...list);
  void el.offsetWidth;
  el.querySelector(".hole__pop")!.textContent = label;
  el.classList.add("is-hit", ...list);
  setTimeout(() => el.classList.remove("is-hit", ...list), ms);
}
