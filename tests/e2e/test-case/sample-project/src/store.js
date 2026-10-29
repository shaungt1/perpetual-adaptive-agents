// Minimal note store: keeps notes in memory. Persistence is a planned task.
export const notes = [];
export function add(text) { notes.push({ id: notes.length + 1, text }); return notes.length; }
