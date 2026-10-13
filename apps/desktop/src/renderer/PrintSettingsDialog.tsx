import { useCallback, useEffect, useRef, useState } from "react";
import { BOOK_THEME_OPTIONS, printTypography } from "@drelwick/renderer";
import {
  PRINT_TRIM_PRESETS,
  PrintSettingsSchema,
  PrintTypographySchema,
  type PrintEdition,
  type PrintProfile,
  fromPrintMicrometres,
  toPrintMicrometres,
  type PrintSettings,
  type PrintConfigurationState,
  type PrintUnit,
} from "@drelwick/shared";

const dimensions = [
  "width",
  "height",
  "inside",
  "outside",
  "top",
  "bottom",
  "gutter",
] as const;
type Dimension = (typeof dimensions)[number];
function displayed(settings: PrintSettings): Record<Dimension, string> {
  return Object.fromEntries(
    dimensions.map((key) => [
      key,
      String(
        fromPrintMicrometres(
          key === "width" || key === "height"
            ? settings.trim[key]
            : settings.margins[key],
          settings.unit,
        ),
      ),
    ]),
  ) as Record<Dimension, string>;
}
export function PrintSettingsDialog({
  initial,
  projectId,
  onClose,
}: {
  initial: PrintConfigurationState;
  projectId: string;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const saving = useRef(false);
  const [saved, setSaved] = useState(initial);
  const [settings, setSettings] = useState(initial.settings);
  const [themeId, setThemeId] = useState(
    initial.editions[initial.edition].themeId,
  );
  const [typography, setTypography] = useState(
    initial.editions[initial.edition].typography,
  );
  const [measurements, setMeasurements] = useState(() =>
    displayed(initial.settings),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty =
    themeId !== saved.editions[saved.edition].themeId ||
    JSON.stringify(typography) !==
      JSON.stringify(saved.editions[saved.edition].typography) ||
    JSON.stringify(settings) !== JSON.stringify(saved.settings) ||
    JSON.stringify(measurements) !== JSON.stringify(displayed(saved.settings));
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);

  const validated = useCallback(() => {
    const next = structuredClone(settings);
    for (const key of dimensions) {
      const text = measurements[key];
      // Empty fields and exponent/hex notation are not accidental zero values.
      if (!/^\d+(?:\.\d+)?$/.test(text))
        throw new Error(
          `${key}: enter a non-negative decimal measurement in ${settings.unit}.`,
        );
      const value = toPrintMicrometres(Number(text), settings.unit);
      if (key === "width" || key === "height") next.trim[key] = value;
      else next.margins[key] = value;
    }
    const parsed = PrintSettingsSchema.safeParse(next);
    if (!parsed.success)
      throw new Error(
        parsed.error.issues
          .map((issue) => {
            const key = issue.path.at(-1);
            if (dimensions.includes(key as Dimension) && "minimum" in issue)
              return `${String(key)} must be at least ${fromPrintMicrometres(Number(issue.minimum), settings.unit)} ${settings.unit}.`;
            if (dimensions.includes(key as Dimension) && "maximum" in issue)
              return `${String(key)} must be at most ${fromPrintMicrometres(Number(issue.maximum), settings.unit)} ${settings.unit}.`;
            return `${issue.path.join(" / ")}: ${issue.message}`;
          })
          .join(" "),
      );
    return parsed.data;
  }, [settings, measurements]);
  const save = useCallback(
    async (selection?: { edition: PrintEdition; profile: PrintProfile }) => {
      if (saving.current) return;
      let next: PrintSettings;
      try {
        next = selection ? selection.profile.settings : validated();
        const parsedTypography = PrintTypographySchema.safeParse(
          selection ? selection.profile.typography : typography,
        );
        if (!parsedTypography.success)
          throw new Error(
            "Check typography: body size 9–32 pt, line spacing 1.2–2.5, paragraph spacing 0–1 em and indent 0–2 em. Enter a number in each field.",
          );
      } catch (failure) {
        setError(
          failure instanceof Error ? failure.message : "Check print settings.",
        );
        return;
      }
      saving.current = true;
      setBusy(true);
      setError("");
      setMessage("");
      try {
        const result = await window.drelwick.project.savePrintConfiguration({
          projectId,
          expectedRevision: saved.revision,
          settings: next,
          edition: selection?.edition ?? saved.edition,
          themeId: selection?.profile.themeId ?? themeId,
          typography: selection?.profile.typography ?? typography,
        });
        if (result.ok) {
          setSaved(result.value);
          setSettings(result.value.settings);
          setThemeId(result.value.editions[result.value.edition].themeId);
          setTypography(result.value.editions[result.value.edition].typography);
          setMeasurements(displayed(result.value.settings));
          setMessage(result.warning ?? "Print settings saved.");
        } else setError(result.error.message);
      } catch {
        setError(
          "Unable to save print settings. Your draft remains here; retry before closing.",
        );
      } finally {
        saving.current = false;
        setBusy(false);
      }
    },
    [projectId, saved.revision, saved.edition, themeId, typography, validated],
  );
  useEffect(() => window.drelwick.onSaveRequested(() => void save()), [save]);
  function close() {
    if (
      !saving.current &&
      (!dirty || window.confirm("Discard unsaved print settings?"))
    )
      onClose();
  }
  function changeUnit(unit: PrintUnit) {
    try {
      const next = { ...validated(), unit };
      setSettings(next);
      setMeasurements(displayed(next));
      setError("");
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Correct measurements before changing units.",
      );
    }
  }
  function measurement(key: Dimension, label: string) {
    return (
      <label key={key}>
        {label} ({settings.unit})
        <input
          type="text"
          inputMode="decimal"
          value={measurements[key]}
          readOnly={
            (key === "width" || key === "height") &&
            settings.trim.preset !== "custom"
          }
          onChange={(event) =>
            setMeasurements({ ...measurements, [key]: event.target.value })
          }
        />
      </label>
    );
  }
  return (
    <dialog
      ref={dialog}
      className="project-dialog publication-dialog print-settings-dialog"
      aria-labelledby="print-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s" &&
          !event.altKey &&
          !event.shiftKey &&
          !event.nativeEvent.isComposing
        ) {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }
      }}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="print-settings-title">Print settings</h2>
        <p>
          Each print edition has its own settings and uses the same manuscript.
          Save changes before switching editions, then open Print preview to
          recalculate pages and review preflight before exporting.
        </p>
        <fieldset disabled={busy}>
          <legend>Publishing edition</legend>
          <label>
            Print edition
            <select
              aria-label="Print edition"
              value={saved.edition}
              onChange={(event) => {
                if (dirty) {
                  setError("Save your changes before switching editions.");
                  return;
                }
                const edition = event.target.value as PrintEdition;
                void save({ edition, profile: saved.editions[edition] });
              }}
            >
              <option value="standard">Standard print</option>
              <option value="large-print">Large print</option>
            </select>
          </label>
          {saved.edition === "large-print" && (
            <p>
              The large-print preset is an accessible starting point, not a
              guarantee of accessibility certification, legal compliance or
              publisher acceptance.
            </p>
          )}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Edition typography</legend>
          <label>
            Print theme
            <select
              value={themeId}
              onChange={(event) =>
                setThemeId(event.target.value as PrintProfile["themeId"])
              }
            >
              {BOOK_THEME_OPTIONS.map((theme) => (
                <option key={theme.id} value={theme.id}>
                  {theme.name}
                </option>
              ))}
            </select>
          </label>
          {(
            [
              ["baseSizePt", "Body size (pt)", 9, 32],
              ["lineHeight", "Line spacing (multiplier)", 1.2, 2.5],
              ["paragraphSpacingEm", "Paragraph spacing (em)", 0, 1],
              ["paragraphIndentEm", "Paragraph indent (em)", 0, 2],
            ] as const
          ).map(([key, label, min, max]) => {
            const value = typography[key] ?? printTypography(themeId)[key];
            return (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  step="0.05"
                  value={Number.isNaN(value) ? "" : value}
                  onChange={(event) =>
                    setTypography({
                      ...typography,
                      [key]: event.target.valueAsNumber,
                    })
                  }
                />
              </label>
            );
          })}
          <label>
            Paragraph alignment
            <select
              value={typography.alignment ?? printTypography(themeId).alignment}
              onChange={(event) =>
                setTypography({
                  ...typography,
                  alignment: event.target.value as "left" | "justify",
                })
              }
            >
              <option value="left">Left</option>
              <option value="justify">Justified</option>
            </select>
          </label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Page size</legend>
          <label>
            Measurement units
            <select
              value={settings.unit}
              onChange={(event) => changeUnit(event.target.value as PrintUnit)}
            >
              <option value="in">Inches (in)</option>
              <option value="mm">Millimetres (mm)</option>
            </select>
          </label>
          <label>
            Trim size
            <select
              aria-label="Trim size"
              value={settings.trim.preset}
              onChange={(event) => {
                const preset = event.target
                  .value as PrintSettings["trim"]["preset"];
                const next = {
                  ...settings,
                  trim:
                    preset === "custom"
                      ? { ...settings.trim, preset }
                      : {
                          preset,
                          width: PRINT_TRIM_PRESETS[preset].width,
                          height: PRINT_TRIM_PRESETS[preset].height,
                        },
                };
                setSettings(next);
                if (preset !== "custom") {
                  const values = displayed(next);
                  setMeasurements({
                    ...measurements,
                    width: values.width,
                    height: values.height,
                  });
                }
              }}
            >
              {Object.entries(PRINT_TRIM_PRESETS).map(([id, preset]) => (
                <option key={id} value={id}>
                  {preset.label}
                </option>
              ))}
              <option value="custom">Custom dimensions</option>
            </select>
          </label>
          {measurement("width", "Trim width")}
          {measurement("height", "Trim height")}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Mirrored margins</legend>
          <p>
            Inside is the binding edge. Gutter adds extra space to inside once.
            Inside is left on right-hand pages and right on left-hand pages.
          </p>
          {measurement("inside", "Inside margin")}
          {measurement("outside", "Outside margin")}
          {measurement("top", "Top margin")}
          {measurement("bottom", "Bottom margin")}
          {measurement("gutter", "Additional gutter")}
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Chapters and headers</legend>
          <label>
            Chapter starts
            <select
              value={settings.chapterStart}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  chapterStart: event.target
                    .value as PrintSettings["chapterStart"],
                })
              }
            >
              <option value="next-page">Next page</option>
              <option value="recto">Next right-hand page (recto)</option>
            </select>
          </label>
          {(["verso", "recto"] as const).map((side) => (
            <label key={side}>
              {side === "verso"
                ? "Left-hand page header"
                : "Right-hand page header"}
              <select
                value={settings.headers[side]}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    headers: {
                      ...settings.headers,
                      [side]: event.target.value,
                    },
                  })
                }
              >
                <option value="none">None</option>
                <option value="author">Author</option>
                <option value="book-title">Book title</option>
                <option value="chapter-title">Chapter title</option>
              </select>
            </label>
          ))}
          <label>
            <input
              type="checkbox"
              checked={settings.headers.showOnChapterOpening}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  headers: {
                    ...settings.headers,
                    showOnChapterOpening: event.target.checked,
                  },
                })
              }
            />
            Show headers on chapter opening pages
          </label>
        </fieldset>
        <fieldset disabled={busy}>
          <legend>Page numbers</legend>
          <label>
            <input
              type="checkbox"
              checked={settings.pageNumbers.enabled}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  pageNumbers: {
                    ...settings.pageNumbers,
                    enabled: event.target.checked,
                  },
                })
              }
            />
            Show page numbers
          </label>
          <label>
            Page number position
            <select
              value={settings.pageNumbers.position}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  pageNumbers: {
                    ...settings.pageNumbers,
                    position: event.target
                      .value as PrintSettings["pageNumbers"]["position"],
                  },
                })
              }
            >
              <option value="footer-center">Footer, centered</option>
              <option value="footer-outside">Footer, outside edge</option>
            </select>
          </label>
          <label>
            First body page number
            <input
              type="number"
              min="1"
              max="9999"
              step="1"
              value={
                Number.isNaN(settings.pageNumbers.bodyStart)
                  ? ""
                  : settings.pageNumbers.bodyStart
              }
              onChange={(event) =>
                setSettings({
                  ...settings,
                  pageNumbers: {
                    ...settings.pageNumbers,
                    bodyStart: event.target.valueAsNumber,
                  },
                })
              }
            />
          </label>
          <label>
            Front matter numbering
            <select
              value={settings.pageNumbers.frontMatter}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  pageNumbers: {
                    ...settings.pageNumbers,
                    frontMatter: event.target
                      .value as PrintSettings["pageNumbers"]["frontMatter"],
                  },
                })
              }
            >
              <option value="roman">Lowercase Roman (i, ii, iii)</option>
              <option value="none">None</option>
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.pageNumbers.showOnChapterOpening}
              onChange={(event) =>
                setSettings({
                  ...settings,
                  pageNumbers: {
                    ...settings.pageNumbers,
                    showOnChapterOpening: event.target.checked,
                  },
                })
              }
            />
            Show page numbers on chapter opening pages
          </label>
        </fieldset>
        <p>
          Print uses bundled Noto Sans for Modern and Noto Serif for Classic and
          Literary. Typography overrides apply only to this edition; EPUB keeps
          its own theme.
        </p>
        <p role="status">
          {dirty ? "Unsaved print settings" : "No unsaved print settings"}
          {message ? `. ${message}` : ""}
        </p>
        {error && (
          <p className="error-message" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="submit" disabled={busy}>
            {busy ? "Saving…" : "Save print settings"}
          </button>
          <button type="button" disabled={busy} onClick={close}>
            Close
          </button>
        </div>
      </form>
    </dialog>
  );
}
