import { expect, it, vi } from "vitest";
import type {
  BrowserWindow,
  MenuItem,
  MenuItemConstructorOptions,
} from "electron";
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

it.each(["win32", "darwin", "linux"] as const)(
  "routes Save to the focused window on %s",
  (platform) => {
    installApplicationMenu(platform);
    const template = buildFromTemplate.mock.lastCall![0];
    expect(setApplicationMenu).toHaveBeenLastCalledWith(template);
    expect(template.some((item) => item.role === "appMenu")).toBe(
      platform === "darwin",
    );
    const file = template.find((item) => item.label === "File")!;
    const save = (file.submenu as MenuItemConstructorOptions[])[0]!;
    expect(save.accelerator).toBe("CommandOrControl+S");
    const send = vi.fn();
    fromId.mockReturnValue({ webContents: { send } });
    save.click!({} as MenuItem, { id: 7 } as BrowserWindow, {});
    expect(send).toHaveBeenCalledExactlyOnceWith("command:save");
    expect(fromId).toHaveBeenLastCalledWith(7);
    expect(() => save.click!({} as MenuItem, undefined, {})).not.toThrow();
  },
);
