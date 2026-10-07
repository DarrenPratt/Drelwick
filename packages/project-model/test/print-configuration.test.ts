import { expect, it } from "vitest";
import {
  defaultPrintSettings,
  PrintSettingsSchema,
  PRINT_TRIM_PRESETS,
  fromPrintMicrometres,
  toPrintMicrometres,
  printPageGeometry,
} from "@drelwick/shared";
import { PrintConfigurationSchema } from "../src/index.js";

it("validates deterministic independent novel defaults and the versioned component", () => {
  const settings = defaultPrintSettings();
  expect(settings.trim).toEqual({
    preset: "6x9",
    width: 152400,
    height: 228600,
  });
  expect(printPageGeometry(settings, "recto")).toEqual({
    left: 22225,
    right: 19050,
    top: 19050,
    bottom: 19050,
    contentWidth: 111125,
    contentHeight: 190500,
  });
  expect(printPageGeometry(settings, "verso")).toMatchObject({
    left: 19050,
    right: 22225,
    contentWidth: 111125,
  });
  settings.margins.gutter = 0;
  expect(defaultPrintSettings().margins.gutter).toBe(3175);
  const data = {
    schemaVersion: 1,
    projectId: "00000000-0000-4000-8000-000000000101",
    settings,
  };
  expect(PrintConfigurationSchema.parse(data)).toEqual(data);
  for (const invalid of [
    { ...data, schemaVersion: 2 },
    { ...data, unknown: true },
    { ...data, projectId: "path" },
  ])
    expect(PrintConfigurationSchema.safeParse(invalid).success).toBe(false);
});
it.each(Object.entries(PRINT_TRIM_PRESETS))(
  "accepts preset %s and rejects mismatched dimensions",
  (preset, trim) => {
    const settings = {
      ...defaultPrintSettings(),
      trim: { preset, width: trim.width, height: trim.height },
    };
    expect(PrintSettingsSchema.safeParse(settings).success).toBe(true);
    expect(
      PrintSettingsSchema.safeParse({
        ...settings,
        trim: { ...settings.trim, width: trim.width + 1 },
      }).success,
    ).toBe(false);
  },
);
it("converts exact imperial/metric values with stable micrometre round trips", () => {
  expect(toPrintMicrometres(6, "in")).toBe(152400);
  expect(toPrintMicrometres(0.125, "in")).toBe(3175);
  expect(toPrintMicrometres(148, "mm")).toBe(148000);
  for (let value = 0; value <= 482600; value += 7)
    for (const unit of ["mm", "in"] as const)
      expect(toPrintMicrometres(fromPrintMicrometres(value, unit), unit)).toBe(
        value,
      );
  for (const value of [NaN, Infinity, -Infinity, -1, Number.MAX_VALUE])
    expect(() => toPrintMicrometres(value, "mm")).toThrow();
  expect(() => toPrintMicrometres(1, "cm" as "mm")).toThrow();
  expect(toPrintMicrometres(1.2345, "mm")).toBe(1235);
});
it("accepts custom boundaries and validates usable area and header/footer reserves", () => {
  const settings = defaultPrintSettings();
  settings.trim = { preset: "custom", width: 76200, height: 101600 };
  settings.margins = {
    mode: "mirrored",
    inside: 10000,
    outside: 10000,
    top: 10000,
    bottom: 10000,
    gutter: 0,
  };
  expect(PrintSettingsSchema.safeParse(settings).success).toBe(true);
  settings.margins.gutter = 6200;
  expect(printPageGeometry(settings, "recto").contentWidth).toBe(50000);
  expect(
    PrintSettingsSchema.safeParse({
      ...settings,
      margins: { ...settings.margins, gutter: 6201 },
    }).success,
  ).toBe(false);
  settings.trim = { preset: "custom", width: 330200, height: 482600 };
  expect(PrintSettingsSchema.safeParse(settings).success).toBe(true);
  for (const key of ["top", "bottom"] as const)
    expect(
      PrintSettingsSchema.safeParse({
        ...settings,
        margins: { ...settings.margins, [key]: 9999 },
      }).success,
    ).toBe(false);
  settings.headers = {
    recto: "none",
    verso: "none",
    showOnChapterOpening: false,
  };
  settings.pageNumbers.enabled = false;
  settings.margins.top = settings.margins.bottom = 5000;
  expect(PrintSettingsSchema.safeParse(settings).success).toBe(true);
});
it("rejects invalid, nonfinite, zero and out-of-range dimensions without clamping", () => {
  for (const value of [0, -1, NaN, Infinity, -Infinity, 0.5, 1000000]) {
    for (const dimension of ["width", "height"])
      expect(
        PrintSettingsSchema.safeParse({
          ...defaultPrintSettings(),
          trim: {
            preset: "custom",
            width: 150000,
            height: 220000,
            [dimension]: value,
          },
        }).success,
      ).toBe(false);
    for (const margin of ["inside", "outside", "top", "bottom"])
      expect(
        PrintSettingsSchema.safeParse({
          ...defaultPrintSettings(),
          margins: { ...defaultPrintSettings().margins, [margin]: value },
        }).success,
      ).toBe(false);
  }
  for (const gutter of [-1, NaN, Infinity, 50001])
    expect(
      PrintSettingsSchema.safeParse({
        ...defaultPrintSettings(),
        margins: { ...defaultPrintSettings().margins, gutter },
      }).success,
    ).toBe(false);
  expect(
    PrintSettingsSchema.safeParse({
      ...defaultPrintSettings(),
      margins: {
        ...defaultPrintSettings().margins,
        top: 100000,
        bottom: 100000,
      },
    }).success,
  ).toBe(false);
  for (const change of [
    { unit: "px" },
    { chapterStart: "publisher-profile" },
    { headers: { recto: "<script>" } },
    { pageNumbers: { bodyStart: 0 } },
    { fontPath: "/font" },
  ])
    expect(
      PrintSettingsSchema.safeParse({ ...defaultPrintSettings(), ...change })
        .success,
    ).toBe(false);
});
