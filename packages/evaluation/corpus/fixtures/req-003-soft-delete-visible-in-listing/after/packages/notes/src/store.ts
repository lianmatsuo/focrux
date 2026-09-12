export interface Note {
  id: string;
  body: string;
  deleted_at: string | null;
}

const notes: Note[] = [
  { id: "note_1", body: "first", deleted_at: null },
  { id: "note_2", body: "second", deleted_at: null },
];

export function all(): Note[] {
  return notes;
}

export function byId(id: string): Note | undefined {
  return notes.find((note) => note.id === id);
}
