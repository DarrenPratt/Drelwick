import { z } from "zod";

export const BuiltinThemeIdSchema = z.enum(["classic", "modern", "literary"]);
export type BuiltinThemeId = z.infer<typeof BuiltinThemeIdSchema>;
export const DEFAULT_BOOK_THEME: BuiltinThemeId = "classic";
export interface BookThemeSelection {
  /** Original saved identity is retained when the installed catalogue lacks it. */
  savedThemeId: string;
  themeId: BuiltinThemeId;
  warning?: "unavailable-theme";
}
