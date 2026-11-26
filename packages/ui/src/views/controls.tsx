import type { ComponentProps, ReactNode } from "react";
import { Search as SearchIcon } from "lucide-react";

export function Filters({ children }: { children: ReactNode }) {
  return <div className="ana-filters">{children}</div>;
}

/** The page's one search box, in a filter row, over a harness's files and in the campaign picker;
 *  `input` passes a ref, keys and the ARIA a combobox's box needs. */
export function Search({
  value,
  onChange,
  placeholder,
  ...input
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
} & Omit<ComponentProps<"input">, "type" | "value" | "onChange" | "placeholder">) {
  return (
    <div className="ana-search">
      <SearchIcon aria-hidden="true" />
      <input
        aria-label={placeholder}
        {...input}
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
