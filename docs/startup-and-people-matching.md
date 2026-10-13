# Startup, shutdown and people matching

The desktop opens a loading screen before starting the database. Its library API now runs in a separate child process, keeping SQLite initialization and indexing off Electron's UI thread. The web renderer displays loading states while fetching the active profile, sources and attributes. Electron's default application menu is removed; the native title bar remains.

On exit, the desktop requests a graceful server shutdown. Scans, conversions and people repair stop, and tracked thumbnail, cover, FFmpeg and Python processes are terminated and checked for exit. Windows cleanup targets only owned process IDs and their descendants. A 15-second desktop deadline terminates the remaining server tree if graceful shutdown stalls. Losing the desktop IPC connection also shuts down the server.

People matching requires complete names in their stored order or unique explicit aliases, with word boundaries. It does not reorder words, join names together, or use partial first/last-name aliases. Ambiguous aliases are ignored, and a shorter name inside another person's recognized full name does not create a second credit. Accents and punctuation are normalized. Tags and categories retain their existing flexible matching.

Existing libraries receive a one-time batched people repair on opening each vault. As requested, legacy assignments that fail strict filename matching are removed, including old manually assigned links whose origin was not recorded. Strict matches are added. Future manual credits and credits from explicit comic metadata are recorded separately and preserved. Backups preserve these origins; old backups default to legacy assignments and are eligible for repair on reopening.

The Cast & artists view includes **Repair people matches** for rerunning the repair. Progress appears both there and in the sidebar. Imports also remove obsolete automatic filename credits, including aliases made ambiguous by a later upload chunk. Rescans replace automatic filename credits while retaining new manual and explicit metadata credits.
