import React, { useId, useRef } from "react";
import { LoaderCircle, Plus, RefreshCw } from "lucide-react";
export function Field({ label, children, hint }) {
  const generatedId = useId();
  const firstChild = React.Children.toArray(children)[0];
  const id = (React.isValidElement(firstChild) && firstChild.props.id) || generatedId;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {React.Children.map(children, (child, i) =>
        i === 0 && React.isValidElement(child)
          ? React.cloneElement(child, {
              id,
              ...(hint ? { "aria-describedby": [child.props["aria-describedby"], `${id}-hint`].filter(Boolean).join(" ") } : {}),
            })
          : child,
      )}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
// Keep the revision that populated a form. Background refresh must not authorize
// a stale draft to overwrite another client's newer data.
export function useRevisionForm(entity) {
  const ref = useRef(entity);
  if (ref.current?.id !== entity?.id) ref.current = entity;
  return [
    ref.current,
    (next) => {
      ref.current = next;
    },
  ];
}
export const Empty = ({ children }) => <div className="empty">{children}</div>;
export const Badge = ({ children }) => (
  <span className={`badge state-${String(children).toLowerCase()}`}>
    {children || "unknown"}
  </span>
);
export const Submit = ({ children, busy }) => (
  <button className="primary" type="submit" disabled={busy} aria-busy={busy || undefined}>
    {busy ? <LoaderCircle size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}
    {children}
  </button>
);
export const Refresh = ({ onClick, label }) => (
  <button type="button" onClick={onClick}>
    <RefreshCw size={15} aria-hidden="true" />
    {label}
  </button>
);
export const Json = ({ value }) => (
  <pre className="code">{JSON.stringify(value, null, 2)}</pre>
);
export function Heading({ title, description, children }) {
  return (
    <header className="page-heading">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{children}</div>
    </header>
  );
}
export function Collection({
  items,
  selected,
  onSelect,
  title = (item) => item.name,
  subtitle = (item) => item.id,
}) {
  return (
    <div className="collection">
      {items.map((item) => (
        <button
          key={item.id}
          className={selected === item.id ? "selected" : ""}
          aria-pressed={selected === item.id}
          onClick={() => onSelect(item.id)}
        >
          <strong>{title(item)}</strong>
          <small>{subtitle(item)}</small>
        </button>
      ))}
    </div>
  );
}
