import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { App } from "electron";

/** Keep settings and unclean-session recovery visible after the product rename. */
export function configureApplicationIdentity(
  application: Pick<App, "getPath" | "setPath" | "setName"> & {
    commandLine: Pick<App["commandLine"], "hasSwitch">;
  },
): void {
  const userData = application.commandLine.hasSwitch("user-data-dir")
    ? application.getPath("userData")
    : join(application.getPath("appData"), "@bookeditor", "desktop");
  mkdirSync(userData, { recursive: true });
  application.setPath("userData", userData);
  application.setPath("sessionData", userData);
  application.setName("SAREL");
}
