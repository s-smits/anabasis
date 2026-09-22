import type { ReactNode } from "react";
import { Search as SearchIcon } from "lucide-react";

/** The filter row shared by the case and evidence tables. */
export function Filters({ children }: { children: ReactNode }) {
  return <div className="ana-filters">{children}</div>;
}

export function Search({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="ana-search">
      <SearchIcon aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
    </div>
  );
}

export function Select({
  label,
  value,
  onChange,
  values,
  format = (item: string) => item,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  values: string[];
  format?: (value: string) => string;
}) {
  return (
    <label>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {values.map((item) => (
          <option value={item} key={item}>
            {format(item)}
          </option>
        ))}
      </select>
    </label>
  );
}
