
/* Acknowledged state patches. Arrays remain atomic to preserve entity ordering. */
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const copy = value => JSON.parse(JSON.stringify(value));

function changes(before, after, path, output) {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  if (!object(before) || !object(after)) {
    output.push([path, after]);
    return;
  }
  for (const key of Object.keys(before)) {
    if (!(key in after)) output.push([[...path, key]]);
  }
  for (const key of Object.keys(after)) {
    if (unsafeKeys.has(key)) throw Error('invalid_state_key');
    changes(before[key], after[key], [...path, key], output);
  }
}

export function encodeState(current, previous, base, revision) {
  const state = copy(current);
  const full = {revision, full: state};
  if (!previous) return {wire: full, state};
  const ops = [];
  changes(previous, state, [], ops);
  const patch = {base, revision, ops};
  return {wire: JSON.stringify(patch).length < JSON.stringify(full).length ? patch : full, state};
}

export function decodeState(wire, previous, revision) {
  if (!wire || !Number.isSafeInteger(wire.revision)) throw Error('invalid_state_patch');
  if (Object.hasOwn(wire, 'full')) return copy(wire.full);
  if (wire.base !== revision || !previous || !Array.isArray(wire.ops)) throw Error('state_base_mismatch');
  let state = copy(previous);
  for (const op of wire.ops) {
    if (!Array.isArray(op) || !Array.isArray(op[0]) || op.length > 2) throw Error('invalid_state_patch');
    const path = op[0];
    if (path.some(key => typeof key !== 'string' || unsafeKeys.has(key))) throw Error('invalid_state_patch');
    if (!path.length) {
      if (op.length !== 2) throw Error('invalid_state_patch');
      state = copy(op[1]);
      continue;
    }
    let parent = state;
    for (const key of path.slice(0, -1)) {
      if (!object(parent) || !Object.hasOwn(parent, key)) throw Error('invalid_state_patch');
      parent = parent[key];
    }
    if (!object(parent)) throw Error('invalid_state_patch');
    const key = path.at(-1);
    if (op.length === 1) delete parent[key];
    else parent[key] = op[1];
  }
  return state;
}

