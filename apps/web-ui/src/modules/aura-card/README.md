# Digital Aura result card

The animated personality card the chat shows for a `personality_card` block, with PNG save and
share. Ported from the former `prototypes/digital-aura` mockup.

```
animation/   pure timeline, timings and playback clock (+ tests)
render/      framework-free canvas painters, reveals, motifs; export-time DOM → canvas overlay
components/  ShareCard and its layers; AuraCard (card + format switch + save/share)
content/     one theme per archetype, and the backend house → archetype mapping
export/      PNG rendering and file helpers
layout.ts    9:16 and 4:5 layouts (+ Story-safe test)
```

Artwork and the IHRD logo are served from `public/aura/`: painters need plain URLs.

## Where it plugs in

`modules/chat/components/personality-card.tsx` calls `archetypeForHouse(data.house)`. A house
with a card design shows `AuraCard`; any other house keeps the text card. The full strengths,
tendencies, career groups and quote from the result are always listed under the card.

`AuraCard` is loaded with `next/dynamic` (`ssr: false`), so canvas, Motion and the card fonts
(Montserrat, Noto Serif Display via `next/font`) stay out of the server render and the first
chat bundle.

## House → archetype

| Backend house                              | Card                            |
| ------------------------------------------ | ------------------------------- |
| `house_a` / `theme_artistic_amber`         | Người Sáng Tạo (`creator`)      |
| `house_i` / `theme_investigative_sapphire` | Người Giải Mã (`decoder`)       |
| `house_s` / `theme_social_emerald`         | Người Chữa Lành (`healer`)      |
| `house_e` / `theme_enterprising_ruby`      | Người Dẫn Đường (`leader`)      |
| `house_c` / `theme_conventional_amethyst`  | Người Giữ Nhịp (`temper`)       |
| `house_r` / `theme_realistic_crimson`      | Người Kể Chuyện (`storyteller`) |

The card title, English subtitle, the three short strengths and the fields come from the theme,
not the result: the backend's strengths and career groups are full phrases that do not fit the
card, and the house names ("Hệ Sáng Tạo (Artistic)") differ from the card design. Only the
student's name and the demo flag come from the result.

## Open decisions

- The public `ShareCard` projection (`GET /results/{id}/share-card`) carries only the name, house
  and branding, while the saved image also shows strengths and fields. Agree whether that is fine,
  or extend the projection. Users are mostly minors.
- Not built yet: the report page (majors, fit, reasons, admission blocks). The backend has no
  contract for that data.
- Several archetypes repeat the placeholder fields "Công nghệ · Khoa học · Nghiên cứu".
- `header.top = 38` places the logo above the Story-safe band on purpose; revisit if Stories cut
  it off.
- Not verified: frame rate on physical phones. Video export (MP4/WebM) was dropped with the
  prototype; bring back `mediabunny` behind a dynamic import if the product wants it.
