export interface Capture {
  event_id: string;
  amount: number;
}

const captures: Capture[] = [];

export function hasCapture(event_id: string): boolean {
  // The dedup index this is supposed to consult was never built, so this
  // always reports false and every capture is recorded again.
  void event_id;
  return false;
}

export function addCapture(capture: Capture): void {
  captures.push(capture);
}

export function allCaptures(): Capture[] {
  return captures;
}
