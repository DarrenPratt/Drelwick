# #170 remaining implementation work

Related to #170 — Local manuscript comments and annotations.

The current branch contains partial implementation. Complete the following before
claiming issue acceptance:

1. [ ] **Atomic editor saves:** replay captured ProseMirror steps in core and save
       manuscript text plus mapped anchors as one validated bundle.
2. [ ] **Anchor mapping:** connect StepMaps to editing, formatting, paste and
       undo/redo; preserve exact deleted text and safely handle orphaned anchors.
3. [ ] **Companion undo:** connect the core helpers to ProseMirror history,
       including stale-state refusal and consistent save acknowledgements.
4. [ ] **Durable draft recovery:** implement DraftV1 staging and desktop
       preview/recover/discard/cancel flows. Rolled-back transaction discovery
       currently provides only the foundation.
5. [ ] **Complete sidebar behaviour:** finish focus restoration, keyboard
       navigation, tombstone restoration and dirty-state protection across every
       navigation path.
6. [ ] **Strict validation audit:** complete semantic-slice, Unicode, timestamp,
       resource-limit and mutation-precondition checks.
7. [ ] **Required validation:** complete A01–A10, F02–F06 and M01–M02, including
       killed-process recovery, interrupted migrations, structural operations and
       DOCX/EPUB/PDF privacy canaries.
8. [ ] **Final delivery:** rerun all checks and applicable Electron tests, update
       documentation, and prepare the focused PR.

Use the approved [delivery contracts and validation matrix](169-editorial-delivery.md)
and the [implementation evidence audit](170-implementation-status.md) when
completing this checklist. Use `Closes #170` only when every acceptance criterion
passes. Do not merge the PR.
