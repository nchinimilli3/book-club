# BOOK CLUB — 50-point product design remediation checklist

Status legend: **DONE** implemented in this pass or already implemented and verified; **KEPT** intentionally unchanged at your request.

1. **DONE — Earth palette replaces the pastel feel.** Legacy club tone IDs now resolve into one ocean/slate/umber/clay/moss family so existing data still works.
2. **DONE — Design-system consolidation.** North Star variables now define paper, ink, rules, controls, cover radius, content widths, and semantic colors consistently.
3. **DONE — Desktop navigation reduced.** BOOK CLUB + club context + Club / Find + bell/avatar. Duplicate profile text and extra search chrome removed.
4. **DONE — Header blur removed.** Global chrome is solid paper with a hairline rule.
5. **DONE — Button vocabulary tightened.** Primary and secondary actions use restrained rectangular controls; pills are reserved for selection/state patterns.
6. **DONE — Club masthead flattened.** No floating shadow treatment; hierarchy comes from type, spacing, members, and the rule.
7. **DONE — Ordinary panel shadows removed.** Depth is reserved primarily for physical objects such as covers and sealed notes.
8. **DONE — Hero title restrained.** Normal reading-state titles are capped below cinematic Meeting Mode scale.
9. **DONE — Hero decoration reduced.** The extra color-plane graphic is removed; cover + single tonal field do the visual work.
10. **DONE — Cover tilt restrained.** Hero rotation is reduced so the book feels physical without looking like a repeated template trick.
11. **DONE — “Right now” dashboard removed from the render.** Progress, Reading Room, and meeting context live in the actual reading state instead of a redundant utility module.
12. **DONE — Club Home ends sooner.** The reading state prioritizes hero/progress, one social signal, meeting, and shelf preview rather than stacking equivalent modules.
13. **DONE — Type scale tightened.** Display, page, section, body, and metadata sizes are brought into a more consistent hierarchy; Meeting Mode is the intentional exception.
14. **DONE — Functional small text increased.** Metadata/body hierarchy is less dependent on 11–12px text.
15. **DONE — Mobile nav legibility increased.** Labels and avatar size are larger while retaining the three-destination Club / Find / Me model.
16. **DONE — Mobile hero reduced.** Long book titles and cover area no longer consume excessive first-screen space.
17. **DONE — Search cover wall refined.** Covers lead; title/author are the only persistent supporting metadata, with denser mobile type.
18. **DONE — Book detail composition tightened.** Sticky cover, asymmetric layout, smaller gap, stronger relationship hierarchy.
19. **DONE — Book decision hierarchy simplified.** Personal and club relationships are emphasized while explanatory material visually recedes.
20. **DONE — Reading Room remains Discussion / Companion / My notes.** No return to a feature-dashboard tab model.
21. **DONE — Discussion prose calmed.** Normal thoughts are reduced from oversized pull-quote treatment to a readable editorial text size.
22. **DONE — Post metadata hierarchy clarified.** Person, progress/time, thought, then actions have distinct visual weights.
23. **DONE — “Ask about the book” treated as a tool.** It no longer reads as a generic underlined editorial link.
24. **DONE — Low-confidence companion portrait imagery stays out.** The book remains the stable visual anchor.
25. **DONE — Companion hierarchy is editorial.** Context rows are quieter and support a Worth knowing / People & places / Why it matters reading model.
26. **DONE — My Notes gets a private-paper treatment.** Notes are visually differentiated without turning into another card system.
27. **DONE — Meeting Mode is the signature visual break.** Deep ocean/cream, large type, minimal chrome, full-screen atmosphere.
28. **DONE — Meeting content loses generic card treatment.** Normal meeting content sits directly on the dark field; sealed predictions keep physical-note character.
29. **DONE — Meeting Mode is now one ritual at a time.** Begin → Predictions → Saved for tonight → Moments → Wrap up, with explicit next/back progression.
30. **DONE — Dark treatment remains exclusive to Meeting Mode.** Normal BOOK CLUB stays paper-based so the transition has meaning.
31. **KEPT — Profile/scrapbook direction unchanged.** You explicitly asked to ignore this audit recommendation.
32. **KEPT — Sticker library scope/UI unchanged.** You explicitly asked to ignore this audit recommendation.
33. **KEPT — Sticker manipulation controls unchanged.** Per your interruption, the existing resize/rotate/layer/delete behavior stays intact.
34. **DONE — Shelf rendering outside the scrapbook avoids glossy/overbuilt surface effects.** Shared/archive shelf visuals use simpler material cues.
35. **DONE — Club color is atmosphere, not a page-wide wash.** Paper remains dominant and tone is used structurally/selectively.
36. **DONE — Border hierarchy introduced.** Default and stronger rules exist; rules support grouping instead of substituting for cards everywhere.
37. **DONE — Repeated content relies more on spacing.** Several list/card surfaces are flattened so every row is not visually boxed.
38. **DONE — Modals behave like paper sheets.** Lower radius, restrained shadow, solid backdrop behavior; mobile becomes a bottom sheet.
39. **DONE — Progress-mode selector is restrained.** Chapter / Page / % uses a simple segmented text/tab treatment rather than large pills.
40. **DONE — DNF remains visually non-destructive.** “I’m not finishing this one” is a quiet secondary action, not a red failure state.
41. **DONE — Notification badge uses the Earth semantic palette.** Brick/rust replaces unrelated bright notification red.
42. **DONE — Error semantics use cohesive brick tones.** Software-default reds are replaced with the product’s semantic color language.
43. **DONE — Sparkle/AI cliché decoration removed from recommendation presentation.** Intelligence is communicated through explanation, not AI iconography.
44. **DONE — Recommendation empty state avoids generic lightbulb decoration.** Copy and hierarchy carry the state.
45. **DONE — Icon dependence reduced.** Core navigation/actions keep useful symbols while editorial surfaces rely more on type and content.
46. **DONE — BOOK CLUB wordmark treatment tightened.** Letter spacing/serif usage is restrained without introducing a gimmicky book logo.
47. **DONE — Content widths are contextual.** Text-heavy settings/notifications/Reading Room are narrower than shelf/search/archive surfaces.
48. **DONE — Find page hierarchy is simpler.** The search field and cover wall carry the task rather than explanatory UI or duplicate quick actions.
49. **DONE — Empty states are open compositions.** Global empty-state card/border treatment is removed; borders are used only when semantically needed.
50. **DONE — Spacing rhythm is more editorial.** Tight related content, larger chapter transitions, and less repetitive card-stack cadence.

## Release verification

- TypeScript compile check (`tsc -b`): PASS
- Production smoke checks: PASS
- Vite bundle in this container: BLOCKED by the uploaded macOS Rollup optional binary; source/type/release checks passed before packaging
- Static button / route / runtime / RPC / sticker checks: PASS
- Source files audited: 30
- RPC contracts: 33
- Schema contract: 27 tables / 33 RPCs
- Worker syntax: PASS

## Intentional exceptions

Items 31–33 were deliberately not redesigned after your instruction. Their existing profile/scrapbook/sticker behavior is preserved rather than being simplified to match the rest of the audit.
