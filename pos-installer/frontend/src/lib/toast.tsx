import { useEffect, useState } from "react";
import { Icon } from "../components/Icon";

type Kind = "success" | "error" | "info";

type ToastItem = {
  id: number;
  kind: Kind;
  text: string;
};

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let listeners: Listener[] = [];
let nextId = 1;

function emit() {
  for (const l of listeners) l(items);
}

export function toast(kind: Kind, text: string, duration = 3400) {
  const item: ToastItem = { id: nextId++, kind, text };
  items = [...items, item].slice(-4);
  emit();
  window.setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    emit();
  }, duration);
}

export const toastSuccess = (text: string) => toast("success", text);
export const toastError = (text: string) => toast("error", text, 5000);
export const toastInfo = (text: string) => toast("info", text);

export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    const listener: Listener = (next) => setList(next);
    listeners.push(listener);
    setList(items);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="toast-host" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="toast-icon">
            <Icon
              name={t.kind === "success" ? "checkCircle" : t.kind === "error" ? "alert" : "info"}
              size={16}
            />
          </span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
