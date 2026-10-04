# Zoom files: provenance

Checked 2026-10-04 against OpenScreen (`upstream`, https://github.com/siddharthvaddem/openscreen, `upstream/main`) and Recordly (https://github.com/webadderall/Recordly, `main`, fetched the same day). Authors are given by role, not name; each SHA resolves to the full commit.

**Result: no zoom file carries AGPL obligations.** Two files were ported from Recordly, but on 2026-03-15, a week before Recordly moved to AGPL-3.0. At that time Recordly was MIT. The port therefore carries an MIT notice duty, not an AGPL one.

## Verdicts

| File | First upstream commit | Author | Date | Verdict |
| --- | --- | --- | --- | --- |
| `videoPlayback/zoomRegionUtils.ts` | `4cc1ae7a56c3b4874bdee3290ea10b09399c88e2` "refactoring" | OpenScreen maintainer | 2025-11-08 | `ported from Recordly (license at port time: MIT)` |
| `videoPlayback/zoomTransform.ts` | `4cc1ae7a56c3b4874bdee3290ea10b09399c88e2` "refactoring" | OpenScreen maintainer | 2025-11-08 | `ported from Recordly (license at port time: MIT)` |
| `videoPlayback/zoomSpring.ts` | `02b4e1b45b501409046676298bffbbd087b1ea0a` "cleanup follow effect" | OpenScreen maintainer | 2026-06-04 | `clean` |
| `videoPlayback/zoomSpring.test.ts` | `02b4e1b45b501409046676298bffbbd087b1ea0a` "cleanup follow effect" | OpenScreen maintainer | 2026-06-04 | `clean` |
| `timeline/zoomSuggestionUtils.ts` | `4ecd18086c0379411f839c8e78943dd486fe8c99` "refactor: move zoom suggestion logic into timeline util" | OpenScreen contributor | 2026-02-28 | `clean` |

Paths are under `src/components/video-editor/`. First commits come from `git log --follow --format='%H %ad %an %s' upstream/main -- <file>`.

## Evidence

### Recordly's history and license

- Recordly is a fork of OpenScreen. `git merge-base upstream/main recordly/main` is `85f2388041a5dde653ed84068090a8b0d0c680e2` (2026-02-21). Recordly's first own commit is `c3c5d1ed63ea3e61575fe78a5a786c3c84b76acc` "Initial release of Recordly" (2026-03-10).
- On 2026-03-15 Recordly's `LICENSE`, `LICENSE.md` and `LICENSE-OpenScreen` were all MIT. `LICENSE.md` at `c3c5d1ed` reads "MIT License, Copyright (c) 2026" followed by the Recordly author's handle. At `e32e7be9b44aa4659c32d27eaada8238677a8ae4` (2026-03-15) the README says "Recordly is licensed under the **MIT License**." and shows an MIT badge.
- AGPL text first appears in `c58f885dc5b9a51f9bbc6b72ad672c944cbde19c` "Update LICENSE.md" on 2026-03-22 (`git log -S AFFERO recordly/main`). The README first names AGPL in `ef8d590f5b2b053bf0617dbafe6e95ab1dbf50da`, also on 2026-03-22.
- The sentence "Some features of OpenScreen such as its zoom animations are directly ported from early versions of Recordly" was added on 2026-05-26 in `c1a3f07bc24a04ee5a1fc8eb01772ccb460df64e`.
- Caveat: Recordly rewrote its history on 2026-03-13 (`9435910e99bffe508933fd6420a16e3e6d351cf8`, "History reorganized for upstream alignment"). Commit dates are set by the author. These findings rest on the history Recordly publishes today.

### zoomRegionUtils.ts and zoomTransform.ts: ported, MIT at port time

- Both files were split out of `VideoPlayback.tsx` in `4cc1ae7a` (2025-11-08). OpenScreen added `VideoPlayback.tsx` in `ec37cd7f113c1bd3008e5e397144ef3fa8b28254` (2025-10-17), before Recordly existed.
- Both files were rewritten in `7a8d0f449a1449ebcf13f7f0cad5b26949d9dd12`, "feat: narrow PR to zoom transitions and motion blur", by an OpenScreen contributor on 2026-03-15 (+225 and +228 lines). That commit came in through upstream PR #207 from branch `feat/recordly-cursor-pipeline`, merged in `9d71f509b822a63364eec85f01ce6c34f159c921` the same day. It is the only upstream commit whose message names Recordly (`git log -i --grep=recordly upstream/main`); no upstream diff mentions Recordly (`git log -i -G recordly upstream/main`).
- Ignoring whitespace, `git diff -w --stat e32e7be9 7a8d0f44` over the two files shows only 18 changed lines per file. Against `c3c5d1ed` it is 17. So the code is Recordly's 2026-03-10/15 version, reformatted. The port was made while Recordly was MIT.
- Later upstream changes do not come from Recordly. None of the identifiers they introduce appears anywhere in Recordly's history (`git log -S <id> upstream/main recordly/main`, run for each):

  | Identifier | Introduced by | Date |
  | --- | --- | --- |
  | `MAX_AMOUNT_BOOST` | `c35a33203baa047d6d6c2a7f5f3ed22ef7881cba` | 2026-03-16 |
  | `getResolvedFocus(activeRegion, activeScale, timeMs` | `3be195cc15f54bff333acaa3d296943d1f3d0104` | 2026-04-01 |
  | `sharedCursorFocus` | `163b12d6fc131e5f1b9db742a044c22d439467ce` | 2026-04-01 |
  | `dominantRegionCache` | `7e00cdb1a9eb9da5fb9637921fa1dc4bd6dce54a` | 2026-05-03 |

- Chameleon has not changed either file since forking (`git log upstream/main..main -- <file>` is empty).

### zoomSpring.ts and zoomSpring.test.ts: clean

- Both were added upstream in `02b4e1b4` on 2026-06-04.
- `ZoomSpringState` and `stepZoomSpring` never appear in Recordly's history (`git log -S ZoomSpringState recordly/main` and `git log -S stepZoomSpring --all`). The only hit is `02b4e1b4` itself.

### zoomSuggestionUtils.ts: clean

- `4ecd1808` (2026-02-28) predates Recordly's first commit (2026-03-10). It moved code that OpenScreen added in `a2b9eea90aa96595bf808933c37410fda43b3624` (2026-02-18).
- Upstream's later addition `a3716581b0b6755ef1457cac79079719e168609a` (2026-06-03) moved the suggestion-spacing code out of `TimelineEditor.tsx`. That code has been in OpenScreen since `a2b9eea9`: `git log -S tooCloseToAccepted` finds it there first, and Recordly carries it as inherited code. `git log -S buildAutoZoomSuggestions recordly/main` finds nothing.
- Chameleon's click clustering (`cb8dceab`, 2026-10-03) shares no code with Recordly's. Recordly's AGPL-era click clustering (`d4b5cf77ecd461cc210151566ff83292bef5d3d3`, 2026-05-02) uses a different design: one merge gap with fixed padding, and no spatial radius, deduplication or spread-based depth. Chameleon's names (`clusterClicks`, `CLICK_CLUSTER_GAP_MS`, `depthForClickSpread`) do not appear in Recordly. Both use a 2500 ms gap between clicks, but that is a single tuning number, not shared code.

## Open obligation

The two ported files are MIT code by the Recordly author. MIT requires keeping their copyright notice: "Copyright (c) 2026" followed by the Recordly author's handle (see `LICENSE.md` at Recordly `c3c5d1ed`). Chameleon's `LICENSE` and README credit only OpenScreen. This is not an AGPL problem, but it is an unmet MIT condition, and fixing it is a separate item.
