import { useCallback, useEffect, useRef, useState } from "react";
import {
  PRINT_TRIM_PRESETS,
  PrintSettingsSchema,
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
  const [measurements, setMeasurements] = useState(() =>
    displayed(initial.settings),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const dirty =
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
  const save = useCallback(async () => {
    if (saving.current) return;
    let next: PrintSettings;
    try {
      next = validated();
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
      });
      if (result.ok) {
        setSaved(result.value);
        setSettings(result.value.settings);
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
  }, [projectId, saved.revision, validated]);
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
          Local book layout for future print output. These settings do not
          change your manuscript or ebook. Pagination and PDF export are not
          available yet.
        </p>
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
          Fonts follow the selected book theme and available local fallbacks.
          Font embedding requires appropriate permissions; no fonts are bundled
          or embedded here.
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
