import { cloneState } from "./state.js";

export function createHistory(initialState) {
  let present = cloneState(initialState);
  let past = [];
  let future = [];

  function get() {
    return present;
  }

  function set(next, { replace = false } = {}) {
    if (replace) {
      present = cloneState(next);
      return;
    }
    past.push(cloneState(present));
    present = cloneState(next);
    future = [];
  }

  function commit(mutator) {
    const next = cloneState(present);
    mutator(next);
    set(next);
    return present;
  }

  function preview(mutator) {
    const next = cloneState(present);
    mutator(next);
    set(next, { replace: true });
    return present;
  }

  function finalizePreview(baseState) {
    past.push(cloneState(baseState));
    future = [];
    return present;
  }

  function undo() {
    if (!past.length) return present;
    future.push(cloneState(present));
    present = past.pop();
    return present;
  }

  function redo() {
    if (!future.length) return present;
    past.push(cloneState(present));
    present = future.pop();
    return present;
  }

  function clear() {
    past = [];
    future = [];
  }

  return { get, set, commit, preview, finalizePreview, undo, redo, clear };
}
