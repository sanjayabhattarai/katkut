# Katkut AI

**Turn a day's worth of clips into a postable reel in seconds — entirely on your phone.**

Katkut is a mobile reel *pre-editor*. Drop in ~40 short clips and photos from your day, pick a
vibe, and Katkut analyzes, trims, sequences, and mutes them into a ready-to-post 9:16 reel. Tweak
it in a lightweight built-in editor if you want, then hand off to CapCut, TikTok, or Instagram for
captions, music, and final polish.

It deliberately stops at the rough cut. That's the point — Katkut gets you 90% of the way there in
the time it takes to make coffee, instead of an hour of manual scrubbing.

---

## Why it's different

- **Everything happens on your device.** Clips are analyzed, scored, trimmed, and exported locally
  — nothing is ever uploaded to a server. Your footage never leaves your phone.
- **No FFmpeg.** The entire pipeline — frame analysis, trimming, compositing, encoding — runs on
  native Android Media APIs (`MediaCodec` / `MediaMuxer` / `MediaExtractor`) and hand-rolled OpenGL
  ES, with the hardware encoder doing the heavy lifting. No bundled native binary, no NDK cross-
  compile risk.
- **Vibe-aware editing, not one-size-fits-all cuts.** Auto, Food & Cooking, Travel & Adventure, Mini
  Vlog, and Unboxing & Style each have their own pacing, cut logic, and rejection rules — a food
  reel snaps fast on the sizzle, a travel reel holds long on the view, a vlog ticks like a metronome.
- **Never a harsh crop.** Vertical footage fills the frame; landscape or square footage is shown
  uncropped, centered, over a blurred fill of the same shot — never a hard crop, never black bars.
- **Photos, not just video.** Mix stills into your reel — they get a subtle Ken Burns motion so the
  reel never freezes mid-scroll.

## Tech stack

| Layer | Choice |
|---|---|
| App | React Native + Expo (dev-client build, not Expo Go — native modules require it) |
| Media pipeline (Android) | Native Kotlin modules over `MediaCodec`/`MediaMuxer`/`MediaExtractor`/`MediaMetadataRetriever` + OpenGL ES 2 — no FFmpeg |
| Preview | Media3 ExoPlayer, single gapless playlist |
| Editing brain | A pure TypeScript core (`core/`) with zero React/native imports — fully unit-testable, no device required |
| Auth | Supabase (Google Sign-In) |
| Encoder | Hardware only (`h264_mediacodec`) |
| Platform | Android first; iOS planned (native module ports pending — the UI and editing brain carry over unchanged) |

## Getting started

This is an Expo **dev-client** project — native modules mean you can't use Expo Go.

```bash
cd katkut-app
npm install
npx expo run:android      # builds native code + installs to a connected device/emulator
```

Run the core (pure-TS) test suite:

```bash
cd katkut-app
npm test
```

## Project structure

```
katkut-app/
  app/          screens + editor UI (React Native)
  core/         pure TypeScript editing brain — analysis parsing, scoring, per-vibe rules, EDL.
                No React or native imports; fully unit-tested.
  modules/      native Android media pipeline (analysis, trim/concat/export, preview player)
  services/     auth, drafts/library persistence
marketing/      the project's public site (privacy policy, landing page)
```

The **pipeline**, in one line: pick clips locally → native measures each clip (blur, exposure,
scene cuts, audio energy — no upload) → the pure-TS core scores and selects the best moments per
vibe → user optionally edits the decision list → native assembles the final MP4 with the hardware
encoder → save to gallery + share.

## Status

Android is the primary target and is feature-complete for the initial rough-cut → export → share
loop, including five vibe presets, photo support, and a full timeline editor (trim, reorder, mute,
undo/redo). iOS support is planned — the app and editing logic are already platform-agnostic; only
the native media modules need porting to AVFoundation/VideoToolbox.

## License

All rights reserved.
