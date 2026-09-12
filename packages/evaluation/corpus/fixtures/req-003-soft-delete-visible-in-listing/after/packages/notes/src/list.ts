import { all, type Note } from "./store.js";

export function listNotes(): Note[] {
  return all();
}
