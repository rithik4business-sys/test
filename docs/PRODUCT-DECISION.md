# Product Decision — What TypeWriter Is (authoritative)

**Date:** 2026-09-22 · **Source:** direct from the founder, verbatim intent below.

## The decision

> "There is no web version — only a PowerShell version. The web UI exists so I
> can look at it while designing, building, and testing. The final product is
> this web UI **in the terminal**."

| Surface | Role | Ships? |
|---|---|---|
| **PowerShell / terminal TUI** (`npm start`) | **The product.** Must end up presenting the same UI the web page shows — layout, panels, workflows — rendered natively in the terminal. | ✅ Yes |
| **Web page** (`public/index.html` + `src/server.ts` served) | **Internal design harness.** Reference design + test bench for the founder. Not a product surface, not marketed as one. | ❌ Internal |

## What this means for the roadmap (re-scoped)

The web UI is the **spec**. Every UI capability visible there must exist in the
terminal. Re-scoped sprints (supersedes web-first items in COMPLETENESS-AND-GTM.md):

1. **Sprint A (unchanged):** vim grammar P0 gaps — `f/F/t/T`, `*`/`#`, `%`,
   ranges, `:g`, clipboard, visual dot-repeat. Terminal-native, still foundation.
2. **Sprint B (retargeted → TUI):** project-wide search UI and git
   commit/pull/log/branch UI are built **in the terminal** (server endpoints
   already exist and stay as the engine behind them).
3. **Sprint C (retargeted → TUI):** LSP (hover, definition, diagnostics,
   completion) must work **in the terminal**, not only over the web WS bridge.
4. **Sprint E (retargeted → TUI):** auto-pair, multi-cursor, folding,
   settings panel, quick-open — implemented as terminal panels/dialogs matching
   the web design.
5. **Web harness stays healthy but secondary:** kept working as the visual
   reference and test bench; no new web-only features.

## Engine vs. presentation (unchanged architecture)

`src/server.ts`, `src/github.ts`, `src/editor.ts` core = shared engine.
The presentation layer differs per surface: ANSI/TTY renderer (product) vs.
browser DOM (harness). Feature work targets the engine + TUI renderer first;
the harness gets the same engine behavior automatically through shared modules.

## Positioning note

"PowerShell version" = Windows/PowerShell-first positioning stays the beachhead
(see COMPLETENESS-AND-GTM.md §4.2), and the marketing surface count drops from
two editors to **one product** (terminal), which simplifies the GTM story.
