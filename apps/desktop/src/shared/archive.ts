import type { Request, Snapshot, TaskRow } from "./protocol.js";

type ArchiveFilter = Omit<Extract<Request, { kind: "exportArchive" }>, "kind">;
/** A terminal Ticket state: finished, whether or not it has been filed. */
export const isArchived = (state: string): boolean =>
  ["merged", "closed", "done", "cancelled", "rolled_back"].includes(state);
/** Filed away from Home by hand (S4). A completed ticket that is not filed stays on Home in green. */
export const isFiled = (
  snapshot: Pick<Snapshot, "archived">,
  row: Pick<TaskRow, "repoId" | "ticket">,
): boolean =>
  isArchived(row.ticket.state) &&
  (snapshot.archived?.includes(row.repoId + ":" + row.ticket.key) ?? false);
export const taskTitle = (row: TaskRow, titles: Snapshot["titles"]): string =>
  titles?.[row.repoId + ":" + row.ticket.key] ?? row.ticket.title;

/** The visible archive and its export use the same filters, including all repositories. */
export function archiveRows(
  snapshot: Pick<Snapshot, "tasks" | "titles" | "archived">,
  filter: ArchiveFilter,
): TaskRow[] {
  const search = filter.search.toLowerCase();
  return snapshot.tasks
    .filter(
      (row) =>
        isFiled(snapshot, row) &&
        (filter.repoId === null || row.repoId === filter.repoId) &&
        (filter.outcome === "all" || row.ticket.state === filter.outcome) &&
        [
          taskTitle(row, snapshot.titles),
          row.ticket.key,
          row.repository,
          row.ticket.delivery.pull_request_number ?? "",
        ]
          .join(" ")
          .toLowerCase()
          .includes(search),
    )
    .sort((a, b) =>
      filter.sort === "title"
        ? taskTitle(a, snapshot.titles).localeCompare(
            taskTitle(b, snapshot.titles),
          )
        : (filter.sort === "oldest" ? 1 : -1) *
          a.ticket.updated_at.localeCompare(b.ticket.updated_at),
    );
}

export function archiveCsv(
  rows: TaskRow[],
  titles: Snapshot["titles"],
): string {
  // Spreadsheet applications interpret these prefixes even in a quoted CSV cell.
  const cell = (value: string): string =>
    '"' +
    (/^[\s]*[=+@\-\t\r]/.test(value) ? "'" : "") +
    value.replaceAll('"', '""') +
    '"';
  return [
    ["Ticket", "Task", "Repository", "Outcome", "Pull request", "Updated"],
    ...rows.map((row) => [
      row.ticket.key,
      taskTitle(row, titles),
      row.repository,
      row.ticket.state,
      row.ticket.delivery.pull_request_url ?? "",
      row.ticket.updated_at,
    ]),
  ]
    .map((row) => row.map(cell).join(","))
    .join("\n");
}
