# scripts/oneoff

One-off diagnostic and patch scripts kept for reference.

These were written to investigate a specific model, jar or renderer during
resource-catalog work, and nothing in the repository references them any more:
no other script imports them, and `package.json`, `README.md`, `docs/` and the
source tree never name them. They are kept rather than deleted because they
document how particular icons were diagnosed, and they can be re-run by hand.

Naming tells you what they were for:

- `dump-*.mjs`, `probe-*.mjs` — print structure from a jar or class (read-only).
- `patch-*.mjs`, `fix-*.mjs`, `rewrite-*.mjs` — edited a file in place while
  iterating on a parser or renderer. **These rewrite their target**; re-read the
  script before running one, and expect the target to have moved on since.
- `test-*.ps1` — manual texture/geometry checks against an installed modpack.
- `audit-*.mjs`, `report-*.mjs` — coverage summaries over `.local/` inputs.

They reference local absolute paths under `D:\QQ下载\...` from the machine they
were written on, so most will not run elsewhere without editing those paths.

Scripts that are still wired into the documented workflows stay in `scripts/`:
`docs/statistics-resources.md` covers the catalog rebuild commands, and
`scripts/classify-scripts.mjs` re-derives which files are self-contained if this
set needs revisiting.
