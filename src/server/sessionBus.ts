const subs = new Map<string, Set<(ev: string) => void>>();

export function subscribe(id: string, cb: (ev: string) => void): () => void {
  if (!subs.has(id)) subs.set(id, new Set());
  subs.get(id)!.add(cb);
  return () => {
    const set = subs.get(id);
    if (set) {
      set.delete(cb);
      if (set.size === 0) subs.delete(id);
    }
  };
}

export function emit(id: string, rawEventLine: string) {
  const set = subs.get(id);
  if (set) {
    for (const cb of set) {
      try {
        cb(rawEventLine);
      } catch {
        /* listener died; ignore */
      }
    }
  }
}
