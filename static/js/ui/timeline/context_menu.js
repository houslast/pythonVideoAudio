import { el } from "../../utils/dom.js";

export function createContextMenu() {
  const root = el("div", { class: "contextMenu" });
  root.style.display = "none";
  document.body.append(root);

  function hide() {
    root.style.display = "none";
    root.textContent = "";
  }

  function showAt({ x, y, items }) {
    root.textContent = "";
    for (const it of items) {
      const item = el("div", { class: `menuItem${it.danger ? " danger" : ""}`, text: it.label });
      item.addEventListener("click", () => {
        hide();
        it.onClick();
      });
      root.append(item);
    }
    root.style.left = `${x}px`;
    root.style.top = `${y}px`;
    root.style.display = "block";
  }

  window.addEventListener("click", hide);
  window.addEventListener("blur", hide);
  window.addEventListener("contextmenu", (e) => {
    if (root.style.display === "block" && !root.contains(e.target)) hide();
  });

  return { showAt, hide };
}

