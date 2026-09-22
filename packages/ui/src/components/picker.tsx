import { Check, ChevronDown } from "lucide-react";
import { memo, useEffect, useId, useMemo, useRef, useState } from "react";

/*
 * A picker that uses the page's shared styles.
 *
 * The project and run menus were native `<select>` elements, so the moment either was opened the
 * page opened an operating-system popup: system font, system colours, system row
 * height, and no room for the grouping the run list depends on. The epoch nesting only reads as
 * nesting if the group heading is rendered with the rest of the design.
 *
 * This is a listbox instead of a select: same keyboard contract (arrows move, Enter picks, Escape
 * closes, click outside closes), and the same one-way data flow, with the popup drawn in our own
 * styles. Groups carry an optional heading; a group with no heading renders its options flat.
 */

interface PickerOption {
  value: string;
  label: string;
}

interface PickerGroup {
  key: string;
  label: string | null;
  options: readonly PickerOption[];
}

function PickerInner({
  label,
  value,
  groups,
  onChange,
  placeholder = "Nothing to select",
}: {
  label: string;
  value: string | null;
  groups: readonly PickerGroup[];
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();

  // Flattening the groups is what gives arrow keys one order to walk, so it is derived once per
  // group change instead of on every keystroke and hover.
  const { flat, indexOf } = useMemo(() => {
    const options = groups.flatMap((group) => group.options);
    return { flat: options, indexOf: new Map(options.map((option, index) => [option.value, index])) };
  }, [groups]);
  const current = flat.find((option) => option.value === value) ?? null;
  const empty = flat.length === 0;

  useEffect(() => {
    if (open) document.getElementById(`${id}-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: MouseEvent) => {
      // A click outside the picker root closes it; a target that is not a node never matches.
      const inside = event.target instanceof globalThis.Node && root.current?.contains(event.target);
      if (root.current !== null && inside !== true) setOpen(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [open]);

  function commit(index: number) {
    const option = flat[index];
    if (option !== undefined) onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (empty) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
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
      setActive((index) => (index + step + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) commit(active);
      else {
        setActive(value === null ? 0 : (indexOf.get(value) ?? 0));
        setOpen(true);
      }
    }
  }

  return (
    <div className={`ana-picker ${open ? "is-open" : ""}`} ref={root}>
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
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={open ? `${id}-option-${active}` : undefined}
        onClick={() => {
          setActive(value === null ? 0 : (indexOf.get(value) ?? 0));
          setOpen(!open);
        }}
        onKeyDown={onKeyDown}
      >
        <span className="ana-picker-value" id={`${id}-value`} title={current?.label}>
          {current?.label ?? placeholder}
        </span>
        <ChevronDown />
      </button>
      {open ? (
        <div className="ana-picker-panel" id={`${id}-listbox`} role="listbox" aria-labelledby={`${id}-label`}>
          {groups
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
                      <span>{option.label}</span>
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

/** Memoised: the sidebar re-renders on every workspace poll; the picker can skip rendering when
 *  its props, including the groups, current value and callback, have not changed. */
export const Picker = memo(PickerInner);
