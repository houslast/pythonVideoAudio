export function qs(sel, root = document) {
  const el = root.querySelector(sel);
  if (!el) throw new Error(`Elemento não encontrado: ${sel}`);
  return el;
}

export function qsa(sel, root = document) {
  return Array.from(root.querySelectorAll(sel));
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

export function formatTime(t) {
  const s = Math.max(0, t);
  const mm = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const ms = Math.floor((s - Math.floor(s)) * 1000);
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

export function toast(statusEl, message, ms = 2200) {
  statusEl.textContent = message;
  statusEl.style.color = message.toLowerCase().includes("erro") ? "var(--danger)" : "var(--muted)";
  window.clearTimeout(statusEl.__t);
  statusEl.__t = window.setTimeout(() => {
    statusEl.textContent = "";
  }, ms);
}

