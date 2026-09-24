import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { App } from "electron";

/** Use the Drelwick profile unless an explicit development profile was supplied. */
export function configureApplicationIdentity(
  application: Pick<App, "getPath" | "setPath" | "setName"> & {
    commandLine: Pick<App["commandLine"], "hasSwitch">;
  },
): void {
  const userData = application.commandLine.hasSwitch("user-data-dir")
    ? application.getPath("userData")
    : join(application.getPath("appData"), "@drelwick", "desktop");
  mkdirSync(userData, { recursive: true });
  application.setPath("userData", userData);
  application.setPath("sessionData", userData);
  application.setName("Drelwick");
}
