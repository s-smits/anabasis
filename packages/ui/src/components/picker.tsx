import Fuse from "fuse.js";
import { Check, ChevronDown } from "lucide-react";
import { type FocusEvent, memo, useId, useMemo, useRef, useState } from "react";
import { Search } from "../views/controls.tsx";
import { keyIfDefined } from "../../../../src/meta/optional-key.ts";

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
 * A `filtered` picker narrows its list as the operator types into a search box at the top of the
 * list, which takes focus as the list opens: a key typed on the trigger opens it with that key, the
 * arrows and Enter walk and pick as on the trigger, and Escape clears the filter before it closes the
 * list. The campaign picker needs it: on 30 October the repository held 176 campaigns, and the list
 * was two pickers of bare names with no way to find one but to scroll. Until the same day the filter
 * was typed on the trigger and drawn as text, which no Cmd+A, paste or caret could reach (operator).
 * The filter forgives typos (Fuse.js, `FUZZY`) and puts the closest match first: the list is a few
 * hundred names, so a loose match costs a few extra rows and a strict one hid "stakced" (operator,
 * 30 October).
 *
 * A picker given `chosen` ticks several values: a pick toggles one and the list stays open, as a
 * filter's does, until a press or a Tab outside it or Escape closes it.
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

/** One option as the fuzzy search reads it, with its group's heading. */
interface Entry {
  readonly group: string | null;
  readonly option: PickerOption;
}

/** Lenient: a match anywhere in a field, at most 40% of it misspelt, the option's own name weighed
 *  first, and each word of the query matched apart (extended search), so that "opus air" finds the
 *  Opus campaign on the Air and not every Opus campaign. */
/** The option of a choice that ticks nothing, which every row passes. */
const EVERY = "\u0000every";

const FUZZY = {
  keys: [
    { name: "option.label", weight: 2 },
    { name: "group", weight: 1 },
    { name: "option.value", weight: 1 },
    { name: "option.detail", weight: 0.5 },
    { name: "option.note", weight: 0.5 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  useExtendedSearch: true,
};

/** The active option, brought into view in the list as it becomes active. */
function scrollNearest(option: HTMLButtonElement | null): void {
  option?.scrollIntoView({ block: "nearest" });
}

/** A press inside the list keeps focus where it is, so the list stays open under it; a press in the
 *  search box places its caret. */
function keepFocus(event: React.MouseEvent): void {
  if (!(event.target instanceof HTMLInputElement)) event.preventDefault();
}

/** The search box takes focus as the list opens, its caret after the key that opened it. */
function focusAtEnd(input: HTMLInputElement | null): void {
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}

/** The groups narrowed to the options `query` finds, the closest first in each group and the group
 *  of the closest first. */
function narrowed(groups: readonly PickerGroup[], query: string): readonly PickerGroup[] {
  if (query.trim() === "") return groups;
  const entries: Entry[] = groups.flatMap((group) =>
    group.options.map((option) => ({ group: group.label, option })),
  );
  const rank = new Map(
    new Fuse(entries, FUZZY).search(query.trim()).map(({ item }, at) => [item.option, at]),
  );
  const rankOf = (option: PickerOption) => rank.get(option) ?? Infinity;
  const best = (group: PickerGroup) => Math.min(...group.options.map(rankOf));
  return groups
    .map((group) => ({
      ...group,
      options: group.options
        .filter((option) => rank.has(option))
        .toSorted((one, other) => rankOf(one) - rankOf(other)),
    }))
    .toSorted((one, other) => best(one) - best(other));
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
  icon: Icon,
  chosen,
}: {
  label: string;
  value: string | null;
  groups: readonly PickerGroup[];
  onChange: (value: string) => void;
  placeholder?: string;
  /** Typing narrows the list. */
  filtered?: boolean;
  /** The values ticked in a list that holds several: a pick toggles one and leaves the list open
   *  until focus leaves the picker or Escape closes it. */
  chosen?: ReadonlySet<string>;
  /** What the trigger shows for the current option, where it differs from the option's own line. */
  shown?: { readonly label: string; readonly detail?: string };
  /** The trigger's icon, the whole trigger where the sidebar is collapsed. */
  icon?: typeof Check;
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
    if (chosen !== undefined) return;
    close();
    trigger.current?.focus();
  }
  const ticked = (option: PickerOption) => chosen?.has(option.value) ?? option.value === value;

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
    const inBox = event.target instanceof HTMLInputElement;
    if (event.key === "Escape") {
      event.preventDefault();
      if (query === "") {
        close();
        trigger.current?.focus();
      } else filterTo("");
      return;
    }
    if (event.key === "Tab") {
      close();
      return;
    }
    if (inBox) {
      if (event.key !== "Enter" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    } else if (filtered && typed(event) && event.key !== " ") {
      event.preventDefault();
      filterTo(event.key);
      return;
    }
    if (open && !inBox && (event.key === "Home" || event.key === "End")) {
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
    if (event.key === "Enter" || (event.key === " " && !inBox)) {
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
      <div className="ana-picker-field">
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
          {Icon === undefined ? null : <Icon className="ana-picker-icon" aria-hidden="true" />}
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
            aria-multiselectable={chosen === undefined ? undefined : true}
            aria-labelledby={`${id}-label`}
            onMouseDown={keepFocus}
          >
            {filtered ? (
              <div className="ana-picker-filter">
                <Search
                  ref={focusAtEnd}
                  value={query}
                  onChange={filterTo}
                  placeholder="Type to filter"
                  aria-label={`Filter ${label.toLowerCase()}s`}
                  aria-controls={`${id}-listbox`}
                  aria-activedescendant={flat.length > 0 ? `${id}-option-${active}` : undefined}
                  onKeyDown={onKeyDown}
                />
                {query === "" ? null : (
                  <span aria-live="polite">
                    {flat.length === 0
                      ? "nothing matches"
                      : `${String(flat.length)} ${flat.length === 1 ? "match" : "matches"}`}
                  </span>
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
                        aria-selected={ticked(option)}
                        key={option.value}
                        className={`ana-picker-option ${index === active ? "is-active" : ""} ${
                          ticked(option) ? "is-current" : ""
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
    </div>
  );
}

/** Memoised: the sidebar re-renders on every poll of the campaign list; the picker can skip
 *  rendering when its props, including the groups, current value and callback, have not changed. */
export const Picker = memo(PickerInner);

/** A choice in a filter row, in the search box's style: the list opens with a box that finds a
 *  value by typing, as the campaign picker does (operator, 30 October: a native select could not
 *  be searched, and drew in the system's style). It ticks any number of values, and a row passes
 *  where it holds one of them; the first option, `every`, clears the ticks. Until 31 October it
 *  held one value and closed on the pick (operator). */
export function Choose({
  label,
  chosen,
  onChange,
  values,
  every,
  format = (item: string) => item,
  detail,
}: {
  label: string;
  chosen: readonly string[];
  onChange: (chosen: readonly string[]) => void;
  values: readonly string[];
  /** The first option in words, which passes every row, and what it stands for beside them. */
  every: { readonly label: string; readonly detail?: string };
  format?: (value: string) => string;
  /** What a value stands for beside its words, such as how many rows hold it. */
  detail?: (value: string) => string;
}) {
  const ticked = new Set(chosen.length === 0 ? [EVERY] : chosen);
  const groups = [
    {
      key: label,
      label: null,
      options: [
        { value: EVERY, ...every },
        ...values.map((item) => ({
          value: item,
          label: format(item),
          ...keyIfDefined("detail", detail?.(item)),
        })),
      ],
    },
  ];
  return (
    <Picker
      label={label}
      value={chosen[0] ?? EVERY}
      chosen={ticked}
      groups={groups}
      onChange={(item) =>
        onChange(
          item === EVERY
            ? []
            : chosen.includes(item)
              ? chosen.filter((each) => each !== item)
              : [...chosen, item],
        )
      }
      shown={{ label: chosen.length === 0 ? every.label : chosen.map(format).join(", ") }}
      filtered
    />
  );
}
