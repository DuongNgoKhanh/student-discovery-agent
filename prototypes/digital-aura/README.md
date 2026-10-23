# Digital Aura · ShareCard & Report — UI prototype

> **Status: prototype for team review, not production code.** It is not wired to the backend and
> is not deployed. The production version is built by integrating these designs into
> `apps/web-ui`; see **[INTEGRATION.md](./INTEGRATION.md)** for what to port, rewrite or drop.
> Delete this folder once the integration has landed.

Prototype of the result experience for the six SDA archetypes, branded IHRD:

- **Report** (default screen): the student's result with the matching majors, then a share step.
- **ShareCard**: an animated card with a 6-second cinematic introduction, an ambient loop, and PNG and MP4/WebM export.
- **Studio**: an editor for previewing and tuning cards.

It's a standalone static frontend (React 19 + TypeScript + Vite + Tailwind CSS v4 + Motion) that needs no API, login or keys; report data is sample data (see [Report mockup](#report-mockup-default-screen)).

## Project structure

```
src/
  App.tsx                 tabs: #report (default) and #studio
  report/                 report screen, major cards, share sheet, sample data + proposed data contract
  studio/                 card studio (content editor, artwork input)
  sharecard/
    content/              one file per archetype (content + theme + motion signature) and the brand
    animation/            pure timeline (timeline.ts), timings (config.ts), playback hooks
    render/               canvas painters, reveals, motifs, export-time DOM → canvas overlay
    components/           ShareCard and its layers, controllers
    export/               PNG and video encoders (lazy-loaded)
    layout.ts             9:16 and 4:5 card layouts
  assets/archetypes/      shipped artwork (WebP) and the IHRD logo
public/fonts/             Inter + Cormorant Garamond (OFL)
art-masters/              PNG masters, git-ignored (see Artwork)
```

## Run locally

Requires Node.js ≥ 20.19 and pnpm 9.15.9, the repository's pinned version (corepack provides it).

```sh
cd prototypes/digital-aura
corepack pnpm install
corepack pnpm dev          # http://localhost:5173
```

| Script                    | Purpose                                |
| ------------------------- | -------------------------------------- |
| `corepack pnpm dev`       | Dev server with HMR                    |
| `corepack pnpm build`     | Typecheck + production build → `dist/` |
| `corepack pnpm preview`   | Serve the production build             |
| `corepack pnpm test`      | Unit tests (Vitest)                    |
| `corepack pnpm typecheck` | `tsc --noEmit`                         |

Review aids: `?t=1800` freezes the preview at 1.8 s, `?ratio=4:5` opens the feed format, `?reduced=1` forces reduced motion, and `?archetype=decoder` opens a specific template, and `?loop=1` turns auto-replay on.

Video export uses WebCodecs, which needs a secure context; `localhost` qualifies.

## Report mockup (default screen)

The app opens on the student's report (`#report`); the card studio is the second tab (`#studio`). The report follows the main flow: the live card plays its reveal, then the report lists the majors that fit, then **Chia sẻ thẻ** opens the share step.

- **Layout by container width (container queries)**, so the same component is the desktop and the mobile design.
  - Wide: the card is pinned on the left beside the report.
  - Narrow: one column, card first, with a pinned bottom bar holding the share action.
  - "Điện thoại 390px" in the review bar renders the mobile layout inside a phone-sized frame.
- **Top 3 majors** expand like an accordion (the best match starts open). Each one shows:
  - its career group and a fit tier;
  - "Phù hợp nhờ", which links it to the card's strengths;
  - a description, reference admission blocks (tổ hợp xét tuyển) and example careers.
- **Fit as tiers by default** (Rất phù hợp / Phù hợp / Đáng cân nhắc) to avoid false precision; the review bar can switch to percentages. "Kết quả này được tính thế nào?" explains that results are guidance.
- **Share step** (`report/ShareSheet.tsx`):
  - choose 9:16 or 4:5;
  - "Ẩn họ, chỉ hiện tên" is on by default (most users are minors), and it only drops a recognised Vietnamese family name (`report/names.ts`);
  - preview the exact card and export PNG or video.
- **The reveal waits for the artwork,** so slow networks never play the intro on an empty card.

**Data is sample data.** `report/mock-reports.ts` holds it, and `report/types.ts` is the proposed contract. Today the backend result (`PersonalityCardData`) exposes only `career_groups`, `strengths` and `tendencies`, so majors, scores, reasons and admission blocks need a backend extension. "Lưu báo cáo" (PDF) is a placeholder.

## Using the studio

- **Content.** Edit the name, archetype, English name, edition, three strengths and tagline. The preview updates live. Long names and titles shrink to fit.
- **Format.** Choose 9:16 Story (exports at 1080×1920) or 4:5 Feed (exports at 1080×1350). Each ratio has its own hero composition.
- **Motion.** Use play/pause, replay, and the scrubber over the 6 s introduction (with phase markers). Reduced motion follows the OS `prefers-reduced-motion` setting until you flip the switch. When it's on, the card shows the final still frame, and parallax and transport are off.
- **Auto-replay ("Tự phát lại").** Restarts the 6 s introduction each time it ends, the way the exported video loops on social platforms. The setting is remembered in this browser, and `?loop=1` / `?loop=0` overrides it. It's unavailable in reduced motion.
- **Parallax.** On desktop, moving the mouse or pen tilts the card a few degrees. The canvas layers also shift at different depths and a holographic sheen follows the pointer. Touch input never tilts the card, so scrolling on phones stays normal.
- **Artwork.** "Thay artwork" swaps in a PNG/WebP/JPG/AVIF hero (≤ 15 MB). The file stays in memory and is never uploaded. "Ảnh gốc" restores the bundled asset.
- **Export.**
  - **PNG** is the fully revealed still frame.
  - **Video** is the full 6 s introduction at 30 fps, always with full motion, whatever the preview's reduced-motion setting.

## Brand and Story-safe layout

IHRD (Viện Khoa học Ứng dụng và Phát triển Nhân lực) owns the project and is the card's primary identity: its full logo sits top left, with "Self Discovery" top right.

- `src/assets/archetypes/logo-IHRD/Logo-IHRD.png` is the original logo. It isn't edited.
- `ihrd-logo-light.png` next to it is the version the card uses: navy turned white, red accents (dot, tie, underline) kept, anti-aliased edges blended. Navy is unreadable on the dark cards; the light version reads on all six palettes. To regenerate it after a logo change, map each pixel along the navy→red axis to white→red.
- The logo is 84 card units wide, so the two descriptor lines are about 15 px tall in the 1080 px export. It fades in at 0.1–0.6 s, so the brand is on screen before the hero.

**Story-safe 9:16.** Story UIs cover roughly the top and bottom 14% of a 1080×1920 frame (progress bar and avatar above, reply bar below). In 9:16 the identity block ends at 86%, and the artwork and atmosphere still fill the whole frame. The brand header sits at `header.top = 38`, which is **above** the safe band by product decision, so Story UI may overlap the logo; move it to `safe.top` (100) if Stories must show it. `layout.ts` defines the band (`safe`), and `layout.test.ts` checks it. Turn on "Hiện vùng an toàn Story" in the studio (or add `?safe`) to see the band; the guides are never exported. 4:5 keeps its original spacing.

## Artwork

The app ships one **WebP** per archetype in `src/assets/archetypes/<id>/<id>.webp` (quality 90, ~320–450 KB, full master resolution). At 1080 px export the artwork is drawn at about 1210 px, close to 1:1, so exports stay sharp. The masters have no baked-in text, so `erase` is empty for every archetype.

The **PNG masters** (~2.5–2.9 MB each) are not in git, since the repository has no Git LFS and binaries would bloat every clone. Keep them on the design drive; locally they live in the git-ignored `art-masters/`.

| Archetype                   | Master (`art-masters/`)            | Motion anchors in `content/<id>.ts`                                                             |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| Creator                     | `creator.png`                      | Body axis (wing breathing), thorax/head/wing-eye facets, crystals and orbs                      |
| Decoder                     | `decoder.png`                      | Eye glints, crystals, bubbles, apex star                                                        |
| Healer                      | `healer.png`                       | Halo (0.475, 0.245, r 0.095), ripples at the feet, emerald pendant, crystals                    |
| Guide (`leader`)            | `leader.png` (1086×1448, portrait) | `fit: 'width'`, sunrise halo on the sun disc (0.53, 0.31, r 0.2), eye, gold crystals and orbs   |
| Rhythm Keeper (`temper`)    | `temper.png`                       | `rhythm` 80 BPM across 8 facets (eye, crystals, bubbles), `particleShape: 'bubble'`             |
| Storyteller (`storyteller`) | `storyteller.png`                  | Moon halo with `rays: false` (0.53, 0.27, r 0.21), eye, ruby crystals, `particleShape: 'petal'` |

To replace an artwork:

1. Put the new master in `art-masters/` and upload it to the design drive.
2. Write the WebP to `src/assets/archetypes/<id>/<id>.webp`, e.g. `cwebp -q 90 -m 6 art-masters/x.png -o src/assets/archetypes/x/x.webp`, or with Pillow `Image.open('x.png').save('x.webp', 'WEBP', quality=90, method=6)`.
3. Re-check `focal`, `bodyAxis`, `facets`, `halo` and `ripples`. They're normalised 0..1 image coordinates, so they only change if the composition changes. For a portrait master, set `fit: 'width'` and `aspect`.

To try an image without touching code, use "Thay artwork" in the studio.

**Wing animation.** The artwork is one flattened raster, so the wings can't be animated independently. The Creator's ambient loop foreshortens the artwork perpendicular to the body axis, by up to 5%. Geometrically that's a flat wing pair rotating slightly about the body, with no seam. Layered wing artwork (separate left and right wings) would allow true wing flapping.

## Animation architecture

```
            usePlayback ──► time: MotionValue<number>   (single source of truth, ms)
                │ (Motion frameloop, only while playing & visible & not reduced/exporting)
      ┌─────────┴───────────────────────────┐
      ▼                                     ▼
  <canvas> scene                       DOM overlay (Motion)
  sampleScene(t) → painters             overlayStyle(track, t) → useTransform
  one paint per frame (frame.render)    opacity / y / blur written by Motion, no React renders
      │                                     │
      └──────────────┬──────────────────────┘
                     ▼
         ShareCard.createRenderer()  →  exporters (PNG / WebCodecs MP4·WebM / MediaRecorder)
         same painters + measured overlay replayed on canvas at 1080 px
```

- **One timeline, three consumers.** `animation/timeline.ts` holds pure functions: `sampleScene`, `overlayStyle`, `facetGlow` and `phaseAt`. The live canvas, the DOM typography and the exporters all sample them, so an exported frame at _t_ equals the preview at _t_.
- **No per-frame React renders.** Time is a Motion `MotionValue`. DOM text animates through `useTransform`. The canvas repaints from a `time.on('change')` subscription coalesced into Motion's render step, so canvas and DOM update in the same frame. React re-renders only on edits, play/pause, and the four phase-label changes.
- **Canvas for the hero, DOM for the type.** The hero is effects-heavy: additive glows, a radial reveal, orbiting ribbons that pass behind and in front of the butterfly, and depth particles. Canvas 2D renders it cheaply and can be re-rendered offline for video. Typography stays real DOM text, which keeps it crisp, accessible and properly shaped for Vietnamese.
- **Export parity for type.** At export, the overlay's laid-out text and boxes (`data-paint`) are measured once from the live DOM. Measurement uses offsets, so transforms are ignored. They're then repainted per frame with the same `overlayStyle` animation.
- **Cheap effects.** Bloom is a 1/16 downsample drawn upscaled, with no `ctx.filter`, so it works in Safari. Glow sprites are pre-rendered once per colour. Artwork masking runs once per asset. Particles use a seeded PRNG, so preview and export are identical. The canvas backing store follows the display size at DPR ≤ 2.
- **Idle.** Frames are scheduled only while playing. They stop when paused, in reduced motion, during export, or when the tab is hidden.

### Components

| Component / module    | Responsibility                                                                                                                                                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ShareCard`           | Composes the card: canvas scene, layer registry, paint scheduling, DOM overlay, pointer tilt. Exposes `createRenderer()` for export.                                                                                                             |
| `ButterflyHero`       | Loads and prepares the artwork. Draws the radial reveal, 0.9→1 scale, bloom, wing foreshortening and crystal facet light.                                                                                                                        |
| `AuraRibbons`         | Iridescent comet-trail ribbons on tilted elliptical orbits, split into back and front layers for depth. `offsetY` lets a theme orbit the body instead of the face.                                                                               |
| `CrystalShards`       | Faceted glass shards from `theme.shards`. They pop in during the aura sweep, then spin, bob, pulse with the crystal light, and get depth parallax. Themes without shards paint nothing.                                                          |
| `ParticleField`       | Far and near depth layers with drift, twinkle and pointer parallax. The near layer also holds the converging reveal particles.                                                                                                                   |
| `IdentityReveal`      | Name, per-grapheme staggered title (`Intl.Segmenter`), subtitle and footer. Auto-fits long text.                                                                                                                                                 |
| `StrengthChips`       | Staggered glass chips, data-driven, any count. Chips size to their labels, and when a row would truncate, all labels shrink together (13 → 10.5 px). Each chip shows a typographic `glyph` or a line `icon` (Lucide SVG, rasterised for export). |
| `AnimationController` | Play/pause, replay, scrubber, phase markers, reduced-motion switch. Uses `usePlayback`.                                                                                                                                                          |
| `ExportController`    | Detects codec support, then runs PNG and video export with progress, cancel and errors. Lazy-loads the encoders.                                                                                                                                 |
| `render/reveals.ts`   | Phase-1 reveal masks and their light effects (unfold, scan, rise, dawn, droplet, ink).                                                                                                                                                           |
| `render/motifs.ts`    | Per-archetype opening effects (`intro`) and auras (`aura`).                                                                                                                                                                                      |
| `render/painters.ts`  | Pure canvas painters: backdrop, particles, ribbons, butterfly, chrome (veils, sheen, aura sweep, inset frame).                                                                                                                                   |
| `render/overlay.ts`   | DOM → canvas typography replay for export.                                                                                                                                                                                                       |

### Timeline (ms; `animation/config.ts`)

| Phase          | Window    | What happens                                                                                                                                                                                      |
| -------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 · Reveal     | 0–1200    | Atmosphere fades up. 42 particles spiral in and converge on the hero. A radial light mask reveals the butterfly while it scales 0.9 → 1 (in-out and expo-out easing). A soft bloom peaks at 1150. |
| 2 · Aura sweep | 1200–2500 | Ribbons draw on and orbit. Crystal facets flare in sequence. One diagonal light band crosses the card.                                                                                            |
| 3 · Identity   | 2500–3500 | Name rises in. Title letters stagger in with blur-to-sharp. Subtitle, then the three chips, then the footer. Everything settles by 3.5 s.                                                         |
| 4 · Ambient    | 3500 → ∞  | Wings breathe (4.2 s), crystals pulse (3 s), the hero floats (6 s), ribbons orbit and particles drift. Time never wraps, so the intro doesn't replay by accident.                                 |

Reduced motion and the PNG both use `stillTime` (4200 ms) with every ambient term at rest. The table describes the shared defaults; each archetype replaces the opening, reveal, aura and title effects (see [Motion signatures](#motion-signatures)).

## Motion signatures

All cards share the same 6 s skeleton (phase timings, layout, header, chips, footer), so they read as one collection. Each archetype then picks a **reveal**, a **title style** and optional ambient extras in `theme.motion`. These are data only; the styles live in `render/reveals.ts` (masks plus their light effects) and `overlayStyle` / `scrambleGlyph` in `animation/timeline.ts`. They're pure functions of time, so export matches preview frame for frame.

| Archetype     | Opening (`intro`)                                                | Reveal (`reveal`)                              | Aura from 1.2 s (`aura`)                                           | Title (`title`) | Ambient extras                |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------ | --------------- | ----------------------------- |
| Creator       | `pollen`: sparkles fly a figure-eight, then gather into the body | `unfold`: a seam of light, then the wings open | `flight`: sparkle-dust trails on figure-eight flight paths         | `bloom`         | wing breathing                |
| Decoder       | `datarain`: falling columns of 0/1                               | `scan`: scanline over a fading grid            | `cipher`: dashed HUD rings counter-rotating, a sweep, hex labels   | `scramble`      | `eyeScan`                     |
| Healer        | `fireflies`: motes rise from the water                           | `rise`: light rises from the ripples           | `helix`: two strands of light beads spiralling up to the halo      | `breath`        | 5 s breath (halo and ripples) |
| Guide         | `sunrays`: streaks converge into the sun                         | `dawn`: sun first, then the horizon            | `path`: a road of light winding to the sun, with sparks walking it | `path`          | sunrise rays                  |
| Rhythm Keeper | `bubbles`: bursts on the eighth notes                            | `droplet`: a drop and a wave ring              | `waves`: oscilloscope lines that swell on each beat                | `beat`          | beat facets, a ring per bar   |
| Storyteller   | `embers`: sparks lift off the ink front                          | `ink`: spreads from the left                   | `threads`: calligraphic strokes that write on, hold and lift off   | `word`          | lantern `flicker`             |

`converge` and `orbit` (the original shared effects) remain the defaults for any new archetype that doesn't choose. The motifs live in `render/motifs.ts`. The artworks already paint ribbons of their own, so the auras deliberately use other visual languages (dust, beads, HUD lines, scope lines, brush strokes) and a soft dark underlay where they cross near-white areas.

Every reveal fades to fully opaque over its last 15%, so no mask shape can pop at the hand-off. Reduced motion shows the final still frame for every style.

## Data model and new archetypes

Content, appearance and motion are separate:

- `ShareCardData` (`types.ts`) holds the person and result: `name`, `archetype { id, title, subtitle, edition? }`, `strengths[] { label, glyph? | icon? }`, `tagline`, and optional `fields[]`. When `fields` is present, it replaces the tagline in the footer with a ✦-divided line.
- `ArchetypeTheme` holds appearance: palette tokens, ribbon geometry (with an optional `offsetY`), optional crystal `shards`, an optional studio `glow` colour, and an `ArtworkAsset`. The asset holds the focal point, an optional body axis, facets, an optional `halo` and `ripples`, erase masks and feathering.
- `TimelineConfig` holds the motion timings.

To add an archetype, add `content/<id>.ts` exporting a `ShareCardData` and an `ArchetypeTheme`, then register it in `content/index.ts`. The studio switcher, editor and tests pick it up automatically (`content/archetypes.test.ts` validates every registered archetype). No visual component contains archetype-specific strings or coordinates.

### Templates

| Archetype                                        | Hero                      | Palette          |
| ------------------------------------------------ | ------------------------- | ---------------- |
| `creator`: Người Sáng Tạo / The Creator          | Crystal butterfly         | violet, lavender |
| `decoder`: Người Giải Mã / The Decoder           | Lynx                      | icy blue         |
| `healer`: Người Chữa Lành / The Healer           | White heron               | emerald, gold    |
| `leader`: Người Dẫn Đường / The Guide            | Golden deer at sunrise    | amber, gold      |
| `temper`: Người Giữ Nhịp / The Rhythm Keeper     | Otter in swirling water   | aqua             |
| `storyteller`: Người Kể Chuyện / The Storyteller | Red fox under a rose moon | ruby, rose       |

Each card's motion is described in [Motion signatures](#motion-signatures). Names, strengths and fields in `content/*.ts` are sample content; the fields of `decoder`, `leader`, `temper` and `storyteller` still repeat the concept mockups ("Công nghệ · Khoa học · Nghiên cứu") and need real values.

## Browser support

| Feature           | Requirement                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview           | Any evergreen browser (Canvas 2D, `roundRect`).                                                                                                         |
| MP4 export        | WebCodecs with an H.264 encoder (Chrome/Edge, Safari 17+). Encodes offline at full speed (~10–15 s for 1080p).                                          |
| WebM export       | WebCodecs VP9/VP8 (e.g. Firefox 130+), else `MediaRecorder` + `canvas.captureStream`. The fallback records in real time (6 s), so keep the tab visible. |
| Video unavailable | The button explains why. PNG still works.                                                                                                               |

## Open items

See [INTEGRATION.md](./INTEGRATION.md#open-decisions-and-known-gaps) for open decisions, known gaps and the
plan for moving this into `apps/web-ui`.
