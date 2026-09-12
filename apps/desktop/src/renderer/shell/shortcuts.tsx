import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import type { ReactNode } from "react";
import {
  actionForBinding,
  bindingFromEvent,
  parseBinding,
  type ShortcutAction,
  type ShortcutMap,
} from "../../shared/shortcuts.js";

/**
 * One keyboard dispatcher for the whole app (S6G). Screens register a handler
 * for an action while they are mounted; the most recently mounted handler
 * wins, so a dialog over a page takes the binding while it is open.
 */
type Handler = () => void;
interface Registry {
  register: (action: ShortcutAction, handler: Handler) => () => void;
}
const ShortcutContext = createContext<Registry>({
  register: () => () => undefined,
});

// A bare key on a focused control belongs to that control: Enter presses a button, Space flips a switch.
const ownsBareKeys = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement &&
  (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY"].includes(
    target.tagName,
  ) ||
    target.isContentEditable ||
    [
      "button",
      "switch",
      "checkbox",
      "radio",
      "tab",
      "option",
      "menuitem",
      "combobox",
    ].includes(target.getAttribute("role") ?? ""));

export function ShortcutProvider({
  overrides,
  children,
}: {
  overrides: ShortcutMap;
  children: ReactNode;
}) {
  const handlers = useRef(new Map<ShortcutAction, Handler[]>());
  const state = useRef({ overrides });
  state.current = { overrides };
  useEffect(() => {
    const listen = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return;
      const binding = bindingFromEvent(event);
      if (!binding) return;
      const action = actionForBinding(state.current.overrides, binding);
      if (!action) return;
      const parsed = parseBinding(binding);
      // Only a modified binding reaches the app from a focused field or control.
      if (ownsBareKeys(event.target) && !parsed?.meta && !parsed?.ctrl) return;
      const handler = handlers.current.get(action)?.at(-1);
      if (!handler) return;
      event.preventDefault();
      handler();
    };
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, []);
  const register = useCallback((action: ShortcutAction, handler: Handler) => {
    const stack = handlers.current.get(action) ?? [];
    stack.push(handler);
    handlers.current.set(action, stack);
    return () => {
      const current = handlers.current.get(action) ?? [];
      const index = current.lastIndexOf(handler);
      if (index >= 0) current.splice(index, 1);
    };
  }, []);
  return (
    <ShortcutContext.Provider value={{ register }}>
      {children}
    </ShortcutContext.Provider>
  );
}

/** Binds an action to a handler for the life of the calling component; null unbinds. */
export function useShortcut(
  action: ShortcutAction,
  handler: Handler | null,
): void {
  const { register } = useContext(ShortcutContext);
  const latest = useRef(handler);
  latest.current = handler;
  const bound = handler !== null;
  useEffect(() => {
    if (!bound) return;
    return register(action, () => latest.current?.());
  }, [action, bound, register]);
}
