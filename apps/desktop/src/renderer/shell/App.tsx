import { lazy, Suspense, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Button, Notice, cx } from "@focrux/ui";
import { errorMessage, useWorkspace } from "../data.js";
import { InkIcon } from "../InkIcon.js";
import { Brand, HeaderSlotProvider, TitleBar } from "../Screen.js";
import { HomePage } from "../tasks/HomePage.js";
import { Onboarding } from "../settings/Onboarding.js";
import { projectTicket } from "../tasks/ticket-workspace.js";
import { isFiled } from "../../shared/archive.js";
import type { Settings, Snapshot } from "../../shared/protocol.js";
import { Rail, RailToggle, SETTINGS_PAGES } from "./Rail.js";
import { useRailSize } from "./rail-size.js";
import { ShortcutProvider, useShortcut } from "./shortcuts.js";
import { ToastProvider } from "./Toast.js";
const SettingsPage = lazy(() =>
  import("../settings/SettingsPage.js").then((module) => ({
    default: module.SettingsPage,
  })),
);
const Composer = lazy(() =>
  import("../tasks/Composer.js").then((module) => ({
    default: module.Composer,
  })),
);
const TaskPage = lazy(() =>
  import("../tasks/TaskPage.js").then((module) => ({
    default: module.TaskPage,
  })),
);

export type TaskView =
  | "auto"
  | "contract"
  | "loop"
  | "output"
  | "review"
  | "merge"
  | "decisions"
  | "called-off"
  | "complete";
export type SettingsSection =
  | "general"
  | "usage"
  | "connections"
  | "providers"
  | "repositories"
  | "about"
  | "shortcuts";
export type Route =
  | {
      page: "home" | "archive" | "new" | "setup" | "settings" | SettingsSection;
    }
  | {
      page: "task";
      repoId: string;
      key: string;
      view?: TaskView;
      edit?: boolean;
    };
const PAGES = [
  "home",
  "archive",
  "new",
  "setup",
  "settings",
  "general",
  "usage",
  "connections",
  "providers",
  "repositories",
  "about",
  "shortcuts",
] as const;
export interface PageProps {
  workspace: Snapshot;
  navigate: (route: Route) => void;
}
function readRoute(): Route {
  const parts = location.hash.slice(1).split("/").map(decodeURIComponent);
  const [page, repoId, key, view] = parts;
  if (page === "task" && repoId && key)
    return {
      page,
      repoId,
      key,
      view: ([
        "contract",
        "loop",
        "output",
        "review",
        "merge",
        "decisions",
        "called-off",
        "complete",
      ].includes(view ?? "")
        ? view
        : "auto") as TaskView,
      edit: view === "edit",
    };
  if ((PAGES as readonly string[]).includes(page ?? ""))
    return { page } as Route;
  return { page: "home" };
}
/** Theme, text size and reduced motion are attributes on the document that the tokens read (S6F). */
function applyAppearance(
  settings: Pick<Settings, "theme" | "textSize" | "reduceMotion">,
): void {
  const root = document.documentElement;
  if (settings.theme === "system") delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  if (settings.textSize === "default") delete root.dataset.textSize;
  else root.dataset.textSize = settings.textSize;
  if (settings.reduceMotion) root.dataset.motion = "reduced";
  else delete root.dataset.motion;
}
function Frame({
  route,
  navigate,
  collapsed,
  children,
}: {
  route: Route;
  navigate: (route: Route) => void;
  collapsed: boolean;
  children: ReactNode;
}) {
  useShortcut("create", () => navigate({ page: "new" }));
  useShortcut("home", () => navigate({ page: "home" }));
  useShortcut("archive", () => navigate({ page: "archive" }));
  // The rail owns ⌘3 while it is open (it raises the pill); collapsed, the binding still has to reach settings.
  useShortcut(
    "settings",
    collapsed ? () => navigate({ page: "general" }) : null,
  );
  // On the Archive itself the page binds ⇧⌘K to its search box.
  useShortcut(
    "archiveSearch",
    route.page === "archive" ? null : () => navigate({ page: "archive" }),
  );
  return children;
}
/** Under a hidden macOS title bar the rail runs beneath the traffic lights; every other host keeps its own chrome. */
const INSET_CHROME =
  typeof navigator !== "undefined" &&
  navigator.userAgent.includes("Electron/") &&
  /Mac/.test(navigator.platform);
export function App() {
  const workspace = useWorkspace();
  useEffect(() => {
    if (INSET_CHROME) document.documentElement.dataset.chrome = "inset";
  }, []);
  const rail = useRailSize();
  const [route, setRoute] = useState<Route>(readRoute);
  const navigate = (next: Route): void => {
    const hash =
      next.page === "task"
        ? [
            "task",
            next.repoId,
            next.key,
            next.edit ? "edit" : (next.view ?? "auto"),
          ]
            .map(encodeURIComponent)
            .join("/")
        : next.page;
    location.hash = hash;
    setRoute(next);
  };
  useEffect(() => {
    const changed = (): void => setRoute(readRoute());
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, []);
  const appearance = workspace.data?.settings;
  useEffect(() => {
    if (appearance) applyAppearance(appearance);
  }, [appearance?.theme, appearance?.textSize, appearance?.reduceMotion]);
  if (workspace.isPending)
    return (
      <main className="launch">
        <Brand />
        <p>Opening your workspace…</p>
      </main>
    );
  if (workspace.error || !workspace.data)
    return (
      <main className="fatal">
        <h1>Your workspace couldn’t load.</h1>
        <Notice tone="danger">{errorMessage(workspace.error)}</Notice>
        <Button
          onClick={() => {
            void workspace.refetch();
          }}
        >
          Try again
        </Button>
      </main>
    );
  const data = workspace.data,
    props = { workspace: data, navigate };
  const setup = !data.settings.onboardingComplete || route.page === "setup";
  const settings = (SETTINGS_PAGES as readonly string[]).includes(route.page);
  const section: SettingsSection =
    route.page === "settings" || !settings
      ? "general"
      : (route.page as SettingsSection);
  const attention = data.tasks.filter(
    (row) => !isFiled(data, row) && projectTicket(data, row).attention,
  ).length;
  // One frame per page or ticket: moving between a ticket's views must not remount it and lose where you were.
  const frameKey =
    route.page === "task"
      ? ["task", route.repoId, route.key].join("/")
      : route.page;
  const page = setup ? (
    <Onboarding {...props} />
  ) : route.page === "task" ? (
    <TaskPage
      key={route.repoId + ":" + route.key}
      {...props}
      repoId={route.repoId}
      taskKey={route.key}
      view={route.view ?? "auto"}
      edit={route.edit ?? false}
    />
  ) : route.page === "new" ? (
    <Composer {...props} />
  ) : settings ? (
    <SettingsPage {...props} section={section} />
  ) : (
    <HomePage key={route.page} {...props} archive={route.page === "archive"} />
  );
  return (
    <ShortcutProvider overrides={data.settings.shortcuts}>
      <ToastProvider>
        <Frame
          route={route}
          navigate={navigate}
          collapsed={!setup && rail.collapsed}
        >
          <HeaderSlotProvider>
            <div
              className={cx("app-shell", "app--" + data.mode)}
              data-preview={data.mode === "preview" || undefined}
            >
              {/* The bar is the drag region; the toggle and the header's controls punch no-drag holes in it. */}
              <TitleBar>{!setup && <RailToggle />}</TitleBar>
              <div className="app-body">
                {!setup && !rail.collapsed && (
                  <Rail
                    route={route}
                    navigate={navigate}
                    attention={attention}
                  />
                )}
                <main id="content" className="workspace-shell">
                  {data.errors.length > 0 && (
                    <div className="workspace-errors">
                      {data.errors.map((error) => (
                        <Notice key={error} tone="danger">
                          {error}
                        </Notice>
                      ))}
                    </div>
                  )}
                  <Suspense
                    fallback={
                      <div className="launch">
                        <InkIcon name="dots" />
                        <p>Opening page…</p>
                      </div>
                    }
                  >
                    <div className="page-frame fx-page" key={frameKey}>
                      {page}
                    </div>
                  </Suspense>
                </main>
              </div>
              {data.mode === "preview" && (
                <div
                  className="preview-indicator"
                  title="Interactive preview with sample records. No coding agents run and no repositories are accessed."
                >
                  Sample workspace
                </div>
              )}
            </div>
          </HeaderSlotProvider>
        </Frame>
      </ToastProvider>
    </ShortcutProvider>
  );
}
