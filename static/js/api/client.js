function freesoundHeaders() {
  try {
    const token = window.localStorage.getItem("audioEditor.freesound.token");
    if (!token) return {};
    return { "x-freesound-token": token };
  } catch {
    return {};
  }
}

export async function apiGet(path, params = {}) {
  const url = new URL(path, window.location.origin);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: freesoundHeaders() });
  if (!res.ok) throw new Error(await safeError(res));
  return res.json();
}

export async function apiPostJson(path, body) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...freesoundHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await safeError(res));
  return res.json();
}

export async function apiPostFile(path, file, fieldName = "file") {
  const fd = new FormData();
  fd.append(fieldName, file, file.name);
  const res = await fetch(path, { method: "POST", headers: freesoundHeaders(), body: fd });
  if (!res.ok) throw new Error(await safeError(res));
  return res.json();
}

function buildHeaders() {
  const token = window.localStorage.getItem("audioEditor.freesound.token") || "";
  const headers = {};
  if (token.trim()) headers["X-Freesound-Token"] = token.trim();
  return headers;
}

async function safeError(res) {
  try {
    const data = await res.json();
    return data.detail || JSON.stringify(data);
  } catch {
    return `${res.status} ${res.statusText}`;
  }
}
