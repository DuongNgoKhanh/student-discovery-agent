# Integrating Digital Aura into `apps/web-ui`

This prototype shows the intended result experience: report first, then share. Production code
belongs in `apps/web-ui` (Next.js 15, React 19, Tailwind 3.4), wired to the real result APIs.
This guide says what to carry over, what to rewrite and what to drop. Remove
`prototypes/digital-aura/` once the integration has landed.

## Target layout

Follow the existing feature convention (`src/features/<feature>/{api,components,hooks,types}`):

```
apps/web-ui/src/features/result-card/
  api/            queries for the result and the share card (React Query, generated API types)
  card/           ported ShareCard engine (see the table below)
  content/        archetype themes keyed by the backend's theme_ref / house_id
  components/     ResultReport, MajorCard, ShareSheet
  index.ts
apps/web-ui/src/app/(app)/results/[resultId]/page.tsx   report route
apps/web-ui/public/archetypes/<id>.webp                   artwork (or import from the feature)
```

## What to port, rewrite or drop

| Prototype path                                                            | Action                                          | Notes                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sharecard/animation/timeline.ts`, `config.ts`, `clock.ts`                | **Port as is**                                  | Pure functions, covered by tests. Bring `timeline.test.ts` along.                                                                                                                                                      |
| `sharecard/render/*` (painters, reveals, motifs, scene, artwork, overlay) | **Port as is**                                  | Framework-free canvas code. Two canvas texts name fonts literally (`Inter` in the data rain and cipher labels in `motifs.ts`); point them at the real font family.                                                     |
| `sharecard/export/*`                                                      | **Port**                                        | Keep the dynamic import so `mediabunny` stays out of the main bundle. Per the share-card contract, recheck `expected_result_revision` right before triggering the download.                                            |
| `sharecard/components/*` (ShareCard, layers, controllers)                 | **Port, mark `'use client'`**                   | Canvas, `requestAnimationFrame` and `matchMedia` are client-only. `AnimationController` is a review tool, so drop it unless the product wants a scrubber.                                                              |
| `sharecard/content/*`                                                     | **Port the themes; content comes from the API** | Keep the palette, artwork anchors, ribbons, shards and `motion` signature per archetype. Key them by `house.theme_ref` (or `house_id`) instead of the prototype ids. Names, strengths and fields come from the result. |
| `sharecard/layout.ts`, `types.ts`                                         | **Port**                                        | `layout.test.ts` documents the Story-safe decision (`header.top = 38`).                                                                                                                                                |
| `report/MajorCard.tsx`, `ShareSheet.tsx`, `names.ts`                      | **Port, restyle with web-ui tokens**            | Keep the behaviour: tiers by default, "Phù hợp nhờ", the accordion, family name hidden by default.                                                                                                                     |
| `report/ReportView.tsx`                                                   | **Rewrite as a page**                           | Feed it from React Query. Keep the container-query layout.                                                                                                                                                             |
| `report/types.ts`                                                         | **Proposal for the backend**                    | Majors, scores, reasons and admission blocks don't exist in the contract yet.                                                                                                                                          |
| `report/mock-reports.ts`, `report/ReportPage.tsx`, `studio/*`, `App.tsx`  | **Drop**                                        | Sample data, review bar and editor tooling. URL review params (`?t=`, `?safe`, `?phone`…) go with them.                                                                                                                |

## Data mapping

The card can be fed today from `GET /activities/{activity_id}/result` (`ResultView.data` is a
`PersonalityCardData`), with the share step backed by `GET /results/{result_id}/share-card`.

| Prototype (`ShareCardData`)         | Backend                                    | Notes                                                                                                              |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `name`                              | `display_name`                             |                                                                                                                    |
| `archetype.title`                   | `house.name`                               |                                                                                                                    |
| `archetype.id` → theme              | `house.theme_ref` / `house_id`             | Selects palette, artwork and motion. `mascot_ref` can select the artwork if themes and mascots vary independently. |
| `archetype.subtitle` (English name) | —                                          | Not in the contract. Add it, or keep it in the theme.                                                              |
| `strengths[].label`                 | `strengths[]`                              | Icons are per-archetype presentation: map them in the theme by position or label.                                  |
| `fields`                            | `career_groups` / house `suggested_fields` |                                                                                                                    |
| `tagline`                           | `quote`                                    |                                                                                                                    |
| demo badge                          | `is_demo`, `demo_label`                    | The share card must show `demo_label` when present.                                                                |

**Agree before shipping:** the public `ShareCard` projection deliberately contains only the name,
house and branding, but the card design also shows strengths and fields. Either extend the
projection, or render the shared card without them. Users are mostly minors, so keep "hide family
name" on by default.

## Next.js and Tailwind differences

- **Tailwind 3.4 vs 4.** Container queries (`@container/report`, `@4xl/report:`) need
  `@tailwindcss/container-queries` in v3; the class syntax is the same. Move the `@theme` tokens in
  `index.css` into `tailwind.config.ts`. Arbitrary values (`text-[var(--r-accent)]`) work in both.
- **Motion.** Add `motion` (the prototype uses `motion/react`). The playback design relies on
  `MotionValue` + `useTransform`, so there are no per-frame React renders. Keep that.
- **Fonts.** Load Inter and Cormorant Garamond with `next/font` (include the `vietnamese` subset).
  The export reads fonts from computed styles, so it follows automatically; only the literal names
  in `motifs.ts` need updating.
- **Assets.** Painters need plain URLs. With static imports in Next, use `image.src`; or serve from
  `public/`. Ship WebP only (masters stay on the design drive).
- **SSR.** Render the card client-side only (`'use client'`, or `dynamic(..., { ssr: false })`
  for the canvas tree). The report text can stay server-rendered.

## Open decisions and known gaps

- Backend: majors, fit scores, reasons and admission blocks for the report (`report/types.ts`);
  the share projection fields (above); English subtitle per house.
- Fit shown as tiers vs percentages (the prototype defaults to tiers).
- `header.top = 38` places the logo above the Story-safe band on purpose; revisit if Stories cut
  it off.
- Placeholder content: the fields of several archetypes repeat "Công nghệ · Khoa học · Nghiên
  cứu" from the concept mockups.
- Not verified: frame rate on physical phones; video export in Safari and Firefox.
- "Lưu báo cáo" (PDF) has no implementation; the archetype switcher thumbnails load full WebPs.
