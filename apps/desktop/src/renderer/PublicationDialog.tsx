import { useCallback, useEffect, useRef, useState } from "react";
import { createMatterPage, PublicationSchema } from "@drelwick/project-model";
import {
  MatterTypeSchema,
  PUBLICATION_INCLUSION,
  type PublicationState,
  type PublicationData,
  type PublicationInclusion,
} from "@drelwick/shared";
import { Editor } from "./components/Editor.js";

export function PublicationDialog({
  initial,
  chapters,
  onClose,
}: {
  initial: PublicationState;
  chapters: { id: string; title: string }[];
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saved, setSaved] = useState(initial);
  const [data, setData] = useState<PublicationData>(initial.data);
  const [selected, setSelected] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cover, setCover] = useState<{ id: string; url: string }>();
  const dirty = JSON.stringify(data) !== JSON.stringify(saved.data);
  const page = data.pages.find((entry) => entry.id === selected);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    let active = true;
    if (data.coverAssetId) {
      const id = data.coverAssetId;
      void window.drelwick.images
        .read({ projectId: data.projectId, assetId: id })
        .then((result) => {
          if (!active) return;
          if (result.ok) setCover({ id, url: result.value.dataUrl });
          else
            setMessage(
              "The saved cover is unavailable. Restore it or select a replacement.",
            );
        })
        .catch(() => {
          if (active)
            setMessage(
              "The saved cover is unavailable. Restore it or select a replacement.",
            );
        });
    }
    return () => {
      active = false;
    };
  }, [data.coverAssetId, data.projectId]);
  const close = () => {
    if (
      !busy &&
      (!dirty || window.confirm("Discard unsaved publication changes?"))
    )
      onClose();
  };
  const save = useCallback(async () => {
    if (busy) return;
    if (!PublicationSchema.safeParse(data).success) {
      setMessage("Check publication fields and matter content before saving.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await window.drelwick.project.savePublication({
        projectId: data.projectId,
        expectedRevision: saved.revision,
        data,
      });
      if (result.ok) {
        setSaved(result.value);
        setData(result.value.data);
        setMessage(result.value.warning ?? "Publication saved.");
      } else setMessage(result.error.message);
    } catch {
      setMessage(
        "Unable to save publication. Your unsaved changes remain here; retry before closing.",
      );
    } finally {
      setBusy(false);
    }
  }, [busy, data, saved.revision]);
  useEffect(() => window.drelwick.onSaveRequested(() => void save()), [save]);
  async function chooseCover() {
    if (busy || dirty) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await window.drelwick.project.selectPublicationCover({
        projectId: data.projectId,
        expectedRevision: saved.revision,
      });
      if (result.ok && result.value) {
        setSaved(result.value);
        setData(result.value.data);
        setMessage(result.value.warning ?? "Cover saved.");
      } else if (!result.ok) setMessage(result.error.message);
    } catch {
      setMessage(
        "Unable to replace the cover. The previous cover remains selected.",
      );
    } finally {
      setBusy(false);
    }
  }
  const updatePage = (patch: Partial<PublicationData["pages"][number]>) =>
    setData((value) => ({
      ...value,
      pages: value.pages.map((entry) =>
        entry.id === selected ? { ...entry, ...patch } : entry,
      ),
    }));
  const inclusions = (
    value: PublicationInclusion,
    change: (next: PublicationInclusion) => void,
  ) => (
    <div className="publication-inclusion">
      {(
        [
          ["navigation", "Include in navigation"],
          ["ebook", "Include in ebook"],
          ["print", "Include in print"],
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={value[key]}
            onChange={(event) =>
              change({ ...value, [key]: event.target.checked })
            }
          />
          {label}
        </label>
      ))}
    </div>
  );
  function move(direction: -1 | 1) {
    if (!page) return;
    const siblings = data.pages.filter(
      (entry) => entry.placement === page.placement,
    );
    const other =
      siblings[siblings.findIndex((entry) => entry.id === page.id) + direction];
    if (!other) return;
    const pages = [...data.pages];
    const a = pages.indexOf(page);
    const b = pages.indexOf(other);
    [pages[a], pages[b]] = [other, page];
    setData({ ...data, pages });
  }
  return (
    <dialog
      ref={dialog}
      className="project-dialog publication-dialog"
      aria-labelledby="publication-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          event.stopPropagation();
          void save();
        }
      }}
    >
      <h2 id="publication-title">Publication details and pages</h2>
      <p>
        Publication metadata is initialized from your book details. Changes here
        apply to publishing; existing chapter files remain unchanged. Save and
        close this dialog before leaving the project or exiting.
      </p>
      <p role="status">
        {dirty ? "Unsaved publication changes" : "Publication changes saved"}
      </p>
      {message && <p role="status">{message}</p>}
      <fieldset disabled={busy}>
        <legend>Publication metadata</legend>
        {(
          [
            ["title", "Publication title"],
            ["author", "Publication author"],
            ["language", "Publication language"],
          ] as const
        ).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              value={data.metadata[key]}
              onChange={(event) =>
                setData({
                  ...data,
                  metadata: { ...data.metadata, [key]: event.target.value },
                })
              }
            />
          </label>
        ))}
        <label>
          Description
          <textarea
            value={data.metadata.description}
            onChange={(event) =>
              setData({
                ...data,
                metadata: { ...data.metadata, description: event.target.value },
              })
            }
          />
        </label>
        {data.metadata.identifiers.map((identifier, index) => (
          <div key={index}>
            <label>
              Identifier {index + 1} scheme
              <select
                aria-label={`Identifier ${index + 1} scheme`}
                value={identifier.scheme}
                onChange={(event) =>
                  setData({
                    ...data,
                    metadata: {
                      ...data.metadata,
                      identifiers: data.metadata.identifiers.map(
                        (item, position) =>
                          position === index
                            ? {
                                ...item,
                                scheme: event.target
                                  .value as typeof item.scheme,
                              }
                            : item,
                      ),
                    },
                  })
                }
              >
                <option value="isbn">ISBN</option>
                <option value="uuid">UUID</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>
              Identifier {index + 1}
              <input
                value={identifier.value}
                onChange={(event) =>
                  setData({
                    ...data,
                    metadata: {
                      ...data.metadata,
                      identifiers: data.metadata.identifiers.map(
                        (item, position) =>
                          position === index
                            ? { ...item, value: event.target.value }
                            : item,
                      ),
                    },
                  })
                }
              />
            </label>
            <button
              onClick={() =>
                setData({
                  ...data,
                  metadata: {
                    ...data.metadata,
                    identifiers: data.metadata.identifiers.filter(
                      (_, position) => position !== index,
                    ),
                  },
                })
              }
            >
              Remove identifier {index + 1}
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            setData({
              ...data,
              metadata: {
                ...data.metadata,
                identifiers: [
                  ...data.metadata.identifiers,
                  { scheme: "isbn", value: "" },
                ],
              },
            })
          }
        >
          Add identifier
        </button>
        <h3>Ebook cover</h3>
        {cover?.id === data.coverAssetId && cover && (
          <img
            className="publication-cover"
            src={cover.url}
            alt="Selected ebook cover"
          />
        )}
        <button disabled={dirty} onClick={() => void chooseCover()}>
          {data.coverAssetId ? "Replace ebook cover" : "Select ebook cover"}
        </button>
        {dirty && <p>Save publication changes before selecting a cover.</p>}
        <h3>Add a matter page</h3>
        {MatterTypeSchema.options.map((type) => (
          <button
            key={type}
            onClick={() => {
              const next = createMatterPage(
                type,
                crypto.randomUUID(),
                data.metadata,
              );
              setData({ ...data, pages: [...data.pages, next] });
              setSelected(next.id);
            }}
          >
            Add {type} page
          </button>
        ))}
        {(["front", "body", "back"] as const).map((section) => (
          <section key={section} aria-label={`${section} reading order`}>
            <h3>
              {section === "body"
                ? "Body chapters (manuscript order)"
                : `${section === "front" ? "Front" : "Back"} matter`}
            </h3>
            <ol>
              {section === "body"
                ? chapters.map((chapter) => (
                    <li key={chapter.id}>
                      <strong>{chapter.title}</strong>
                      {inclusions(
                        data.body.find((entry) => entry.id === chapter.id)
                          ?.inclusion ?? PUBLICATION_INCLUSION,
                        (inclusion) =>
                          setData({
                            ...data,
                            body: [
                              ...data.body.filter(
                                (entry) => entry.id !== chapter.id,
                              ),
                              { id: chapter.id, inclusion },
                            ],
                          }),
                      )}
                    </li>
                  ))
                : data.pages
                    .filter((entry) => entry.placement === section)
                    .map((entry) => (
                      <li key={entry.id}>
                        <button
                          aria-pressed={selected === entry.id}
                          onClick={() => setSelected(entry.id)}
                        >
                          {entry.title}
                        </button>
                      </li>
                    ))}
            </ol>
          </section>
        ))}
        {page && (
          <section aria-label="Matter page editor">
            <h3>Edit matter page</h3>
            <label>
              Page title
              <input
                value={page.title}
                onChange={(event) => updatePage({ title: event.target.value })}
              />
            </label>
            <label>
              Page type
              <select
                aria-label="Page type"
                value={page.type}
                onChange={(event) => {
                  const parsed = MatterTypeSchema.safeParse(event.target.value);
                  if (parsed.success) updatePage({ type: parsed.data });
                }}
              >
                {MatterTypeSchema.options.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </label>
            <label>
              Placement
              <select
                aria-label="Placement"
                value={page.placement}
                onChange={(event) =>
                  updatePage({
                    placement:
                      event.target.value === "front" ? "front" : "back",
                  })
                }
              >
                <option value="front">Front matter</option>
                <option value="back">Back matter</option>
              </select>
            </label>
            {inclusions(page.inclusion, (inclusion) =>
              updatePage({ inclusion }),
            )}
            <button onClick={() => move(-1)}>Move page earlier</button>
            <button onClick={() => move(1)}>Move page later</button>
            <Editor
              key={page.id}
              projectId={data.projectId}
              content={page.document}
              editable={!busy}
              title={page.title}
              chapterLabel="Matter page"
              onChange={(document) =>
                updatePage({ document: document as Record<string, unknown> })
              }
            />
          </section>
        )}
      </fieldset>
      <div className="dialog-actions">
        <button disabled={busy || !dirty} onClick={() => void save()}>
          Save publication
        </button>
        <button disabled={busy} onClick={close}>
          Close publication
        </button>
      </div>
    </dialog>
  );
}
