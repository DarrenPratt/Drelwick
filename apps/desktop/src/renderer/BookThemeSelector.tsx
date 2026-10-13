import { useId } from "react";
import { BOOK_THEME_OPTIONS } from "@drelwick/renderer";
import {
  BuiltinThemeIdSchema,
  type BookThemeSelection,
  type BuiltinThemeId,
} from "@drelwick/shared";

export function BookThemeSelector({
  selection,
  disabled,
  message,
  onChange,
}: {
  selection: BookThemeSelection | null;
  disabled: boolean;
  message: string;
  onChange(id: BuiltinThemeId): void;
}) {
  const id = useId();
  return (
    <div className="book-theme-selector">
      <label htmlFor={id}>Book theme</label>
      <select
        id={id}
        value={selection?.themeId ?? ""}
        disabled={disabled || !selection}
        onChange={(event) => {
          const parsed = BuiltinThemeIdSchema.safeParse(event.target.value);
          if (parsed.success) onChange(parsed.data);
        }}
      >
        {!selection && <option value="">Loading theme…</option>}
        {BOOK_THEME_OPTIONS.map((theme) => (
          <option key={theme.id} value={theme.id}>
            {theme.name}
          </option>
        ))}
      </select>
      <p>
        EPUB presentation. Print themes are configured in Print settings.{" "}
        {
          BOOK_THEME_OPTIONS.find((theme) => theme.id === selection?.themeId)
            ?.description
        }
      </p>
      {selection?.warning === "unavailable-theme" && (
        <p role="status">
          The saved theme is unavailable. Classic is shown until you choose
          another theme.
        </p>
      )}
      {message && <p role="status">{message}</p>}
    </div>
  );
}
