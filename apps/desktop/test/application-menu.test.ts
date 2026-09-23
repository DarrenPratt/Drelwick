import { expect, it, vi } from "vitest";
import type {
  BrowserWindow,
  MenuItem,
  MenuItemConstructorOptions,
} from "electron";
import {
  APPLICATION_MENU_COMMAND_CHANNEL,
  SAVE_COMMAND_CHANNEL,
} from "@sarel/shared";
import { installApplicationMenu } from "../src/main/application-menu.js";

const { buildFromTemplate, setApplicationMenu, fromId } = vi.hoisted(() => ({
  fromId: vi.fn(),
  buildFromTemplate: vi.fn(
    (template: MenuItemConstructorOptions[]) => template,
  ),
  setApplicationMenu: vi.fn(),
}));
vi.mock("electron", () => ({
  BrowserWindow: { fromId },
  Menu: { buildFromTemplate, setApplicationMenu },
}));

function submenu(
  item: MenuItemConstructorOptions,
): MenuItemConstructorOptions[] {
  return item.submenu as MenuItemConstructorOptions[];
}

it.each(["win32", "darwin", "linux"] as const)(
  "installs native project menus and platform conventions on %s",
  (platform) => {
    installApplicationMenu(platform);
    const template = buildFromTemplate.mock.lastCall![0];
    expect(setApplicationMenu).toHaveBeenLastCalledWith(template);
    expect(template.some((item) => item.role === "appMenu")).toBe(
      platform === "darwin",
    );
    expect(
      template.some((item) => item.label === "Help" || item.role === "help"),
    ).toBe(true);
    const file = submenu(template.find((item) => item.label === "File")!);
    expect(file.map((item) => item.label ?? item.role)).toEqual(
      platform === "darwin"
        ? [
            "New Project",
            "Open Project",
            "Import manuscript…",
            undefined,
            "Save",
            undefined,
            "Back Up Project…",
            "Restore Project Backup…",
            undefined,
            "Close Project",
          ]
        : [
            "New Project",
            "Open Project",
            "Import manuscript…",
            undefined,
            "Save",
            undefined,
            "Back Up Project…",
            "Restore Project Backup…",
            undefined,
            "Close Project",
            "Exit",
          ],
    );
    expect(template.find((item) => item.role === "editMenu")).toBeDefined();
    expect(template.find((item) => item.role === "viewMenu")).toBeDefined();

    const send = vi.fn();
    const window = {
      id: 7,
      isDestroyed: () => false,
    } as unknown as BrowserWindow;
    fromId.mockReturnValue({ webContents: { send } });
    const [
      newProject,
      openProject,
      importManuscript,
      ,
      save,
      ,
      backupProject,
      restoreProject,
      ,
      closeProject,
    ] = file;
    expect(newProject?.accelerator).toBe("CommandOrControl+N");
    expect(openProject?.accelerator).toBe("CommandOrControl+O");
    expect(save?.accelerator).toBe("CommandOrControl+S");
    newProject?.click!({} as MenuItem, window, {});
    expect(send).toHaveBeenLastCalledWith(
      APPLICATION_MENU_COMMAND_CHANNEL,
      "new-project",
    );
    openProject?.click!({} as MenuItem, window, {});
    expect(send).toHaveBeenLastCalledWith(
      APPLICATION_MENU_COMMAND_CHANNEL,
      "open-project",
    );
    expect(importManuscript?.accelerator).toBe("CommandOrControl+Shift+I");
    importManuscript?.click!({} as MenuItem, window, {});
    expect(send).toHaveBeenLastCalledWith(
      APPLICATION_MENU_COMMAND_CHANNEL,
      "import-manuscript",
    );
    save?.click!({} as MenuItem, window, {});
    expect(send).toHaveBeenLastCalledWith(SAVE_COMMAND_CHANNEL);
    closeProject?.click!({} as MenuItem, window, {});
    expect(send).toHaveBeenLastCalledWith(
      APPLICATION_MENU_COMMAND_CHANNEL,
      "close-project",
    );
    backupProject?.click!({} as MenuItem, window, {});
    expect(send).toHaveBeenLastCalledWith(
      APPLICATION_MENU_COMMAND_CHANNEL,
      "backup-project",
    );
    restoreProject?.click!({} as MenuItem, window, {});
    expect(send).toHaveBeenLastCalledWith(
      APPLICATION_MENU_COMMAND_CHANNEL,
      "restore-project",
    );
    expect(() =>
      closeProject?.click!({} as MenuItem, undefined, {}),
    ).not.toThrow();
  },
);
