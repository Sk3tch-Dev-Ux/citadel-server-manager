## Hotfix — Files editor

### Fixed

- **Files browser editor was blank** — clicking a file opened a tab with the correct breadcrumb but the Monaco code editor never rendered.
  Root cause: the Content-Security-Policy blocked Monaco from fetching its runtime modules (`connectSrc` missing `cdnjs.cloudflare.com`) and from spawning its web workers (`workerSrc` not set).
  Fixed both directives. Also added a visible failure state if the editor ever fails to load again — no more silent blank panes.
