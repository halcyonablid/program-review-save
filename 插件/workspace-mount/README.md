# Workspace Mount

Phase-C vertical slice of the Workspace Mount pluginization work.

Current scope:

- dedicated `ItemView` large leaf
- mandatory `sourceNotePath`
- note-relative JSON load/save
- one leaf per source note
- capsule bridge exposed through a plugin registry API
- minimal tab switching UI

Current non-goals:

- full DataviewJS UI parity
- paradigm panel migration
- snapshot panel migration
- complete relation adapter migration

Integration notes:

- The plugin keeps the source note as the identity anchor.
- `Workspace_Items.json`, `Workspace_TaskNoteBindings.json`, and `Workspace_TaskComments.json` are resolved relative to the source note folder.
- `state-capsules` can discover this host through `window.__workspaceMountPluginApi`.
