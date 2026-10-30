import { Check, ChevronDown } from "lucide-react";
import { type FocusEvent, memo, useId, useMemo, useRef, useState } from "react";

/*
 * A picker that uses the page's shared styles.
 *
 * The project and campaign menus were native `<select>` elements in v1, so the moment either was
 * opened the page opened an operating-system popup: system font, system colours, system row
 * height, and no room for the small label a campaign carries (its worktree, and whether it is a
 * rehearsal's copy).
 *
 * This is a listbox instead of a select: same keyboard contract (arrows move, Enter picks, Escape
 * closes, click outside closes), and the same one-way data flow, with the popup drawn in our own
 * styles. Groups carry an optional heading; a group with no heading renders its options flat.
 *
 * Focus stays on the trigger while the list is open, as a combobox's does: a press inside the list
 * keeps it there, so focus leaving the picker is a press or a Tab outside it, and closes the list
 * (`onBlur`). The active option scrolls into view as it is drawn active, through its ref. Until
 * 14 October both were effects that ran a frame after the list had drawn, one of them a listener on
 * the whole document for as long as the list was open.
 *
 * A `filtered` picker narrows its list as the operator types, with focus still on the trigger: each
 * printable key extends the filter, Backspace shortens it, and Escape clears it before it closes the
 * list. The campaign picker needs it: on 30 October the repository held 176 campaigns, and the list
 * was two pickers of bare names with no way to find one but to scroll.
 */

interface PickerOption {
  value: string;
  label: string;
  /** A small label after the option's own, such as a campaign's state. */
  detail?: string;
  /** A quieter second line under the option, such as a campaign's last reading. */
  note?: string;
}

interface PickerGroup {
  key: string;
  label: string | null;
  options: readonly PickerOption[];
}

/** The active option, brought into view in the list as it becomes active. */
function scrollNearest(option: HTMLButtonElement | null): void {
  option?.scrollIntoView({ block: "nearest" });
}

/** A press inside the list keeps focus on the trigger, so the list stays open under it. */
function keepFocus(event: React.MouseEvent): void {
  event.preventDefault();
}

/** The groups narrowed to the options whose text, or whose group's heading, holds `query`. */
function narrowed(groups: readonly PickerGroup[], query: string): readonly PickerGroup[] {
  if (query === "") return groups;
  const needle = query.toLowerCase();
  const holds = (text: string | null | undefined) => text?.toLowerCase().includes(needle) === true;
  return groups.map((group) => ({
    ...group,
    options: holds(group.label)
      ? group.options
      : group.options.filter(
          (option) =>
            holds(option.label) || holds(option.detail) || holds(option.note) || holds(option.value),
        ),
  }));
}

/** A key that types into the filter: one printable character, with no modifier but Shift. */
function typed(event: React.KeyboardEvent): boolean {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
}

function PickerInner({
  label,
  value,
  groups,
  onChange,
  placeholder = "Nothing to select",
  filtered = false,
  shown,
}: {
  label: string;
  value: string | null;
  groups: readonly PickerGroup[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Typing narrows the list. */
  filtered?: boolean;
  /** What the trigger shows for the current option, where it differs from the option's own line. */
  shown?: { readonly label: string; readonly detail?: string };
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [query, setQuery] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  // Flattening the groups is what gives arrow keys one order to walk, so it is derived once per
  // group or filter change instead of on every hover.
  const { visible, flat, indexOf } = useMemo(() => {
    const kept = narrowed(groups, query);
    const options = kept.flatMap((group) => group.options);
    return {
      visible: kept,
      flat: options,
      indexOf: new Map(options.map((option, index) => [option.value, index])),
    };
  }, [groups, query]);
  const current = shown ?? groups.flatMap((group) => group.options).find((option) => option.value === value);
  const empty = groups.every((group) => group.options.length === 0);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function commit(index: number) {
    const option = flat[index];
    if (option !== undefined) onChange(option.value);
    close();
    trigger.current?.focus();
  }

  /** Types `next` into the filter and opens the list on its first match. */
  function filterTo(next: string) {
    setQuery(next);
    setActive(0);
    setOpen(true);
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    // Focus that leaves for nothing or for something outside the picker closes the list.
    if (
      !(event.relatedTarget instanceof globalThis.Node && event.currentTarget.contains(event.relatedTarget))
    ) {
      close();
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (empty) return;
    if (event.key === "Escape") {
      event.preventDefault();
      if (query === "") close();
      else filterTo("");
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (filtered && typed(event) && (event.key !== " " || query !== "")) {
      event.preventDefault();
      filterTo(query + event.key);
      return;
    }
    if (filtered && event.key === "Backspace" && query !== "") {
      event.preventDefault();
      filterTo(query.slice(0, -1));
      return;
    }
    if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : flat.length - 1);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setActive(value === null ? 0 : (indexOf.get(value) ?? 0));
        setOpen(true);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (flat.length === 0 ? 0 : (index + step + flat.length) % flat.length));
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open && flat.length > 0) commit(active);
      else if (open) close();
      else {
        setActive(value === null ? 0 : (indexOf.get(value) ?? 0));
        setOpen(true);
      }
    }
  }

  return (
    <div className={`ana-picker ${open ? "is-open" : ""}`} onBlur={onBlur}>
      <span className="ana-picker-label" id={`${id}-label`}>
        {label}
      </span>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        className="ana-picker-button"
        disabled={empty}
        aria-haspopup="listbox"
        aria-autocomplete={filtered ? "list" : undefined}
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={open && flat.length > 0 ? `${id}-option-${active}` : undefined}
        onClick={() => {
          setActive(value === null ? 0 : (indexOf.get(value) ?? 0));
          if (open) close();
          else setOpen(true);
          // Safari does not focus a button it clicks, and the list closes as focus leaves it.
          trigger.current?.focus();
        }}
        onKeyDown={onKeyDown}
      >
        <span className="ana-picker-value" id={`${id}-value`} title={current?.label}>
          {current?.label ?? placeholder}
          {current?.detail === undefined ? null : <small> {current.detail}</small>}
        </span>
        <ChevronDown />
      </button>
      {open ? (
        <div
          className="ana-picker-panel"
          id={`${id}-listbox`}
          role="listbox"
          aria-labelledby={`${id}-label`}
          onMouseDown={keepFocus}
        >
          {filtered ? (
            <div className="ana-picker-filter" aria-live="polite">
              {query === "" ? (
                <span>Type to filter</span>
              ) : (
                <>
                  <span className="ana-picker-query">{query}</span>
                  <span>{flat.length === 0 ? "nothing matches" : `${String(flat.length)} match`}</span>
                </>
              )}
            </div>
          ) : null}
          {visible
            .filter((group) => group.options.length > 0)
            .map((group) => (
              <div className="ana-picker-group" key={group.key}>
                {group.label === null ? null : <div className="ana-picker-group-label">{group.label}</div>}
                {group.options.map((option) => {
                  const index = indexOf.get(option.value) ?? 0;
                  return (
                    <button
                      type="button"
                      role="option"
                      id={`${id}-option-${index}`}
                      ref={index === active ? scrollNearest : undefined}
                      tabIndex={-1}
                      aria-selected={option.value === value}
                      key={option.value}
                      className={`ana-picker-option ${index === active ? "is-active" : ""} ${
                        option.value === value ? "is-current" : ""
                      }`}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => commit(index)}
                    >
                      <Check className="ana-picker-tick" />
                      <span>
                        {option.label}
                        {option.detail === undefined ? null : <small> {option.detail}</small>}
                        {option.note === undefined ? null : (
                          <small className="ana-picker-note">{option.note}</small>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/** Memoised: the sidebar re-renders on every poll of the campaign list; the picker can skip
 *  rendering when its props, including the groups, current value and callback, have not changed. */
export const Picker = memo(PickerInner);
