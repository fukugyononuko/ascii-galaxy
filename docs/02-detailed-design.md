# 02 Detailed design

Component IDs are from [01-overview.md](01-overview.md).

## E01 SkyEngine
- Brightness field: brightness = core (exponential fall-off with radius) + disc × arm strength.
- Arms: a logarithmic-spiral pattern that turns rigidly and slowly (keeps the arms' shape, R-03). On top of it, particle noise flows at an angular speed that depends on radius (center faster, outside slower, R-03). Turning the arms themselves differentially would wind them up until they disappear, so the two are kept as separate layers.
- One full turn of the pattern takes about 10 minutes (R-03).
- Tilt: the galaxy plane is tilted and projected, so it looks elliptical on screen (R-01).
- Placement: the center sits on a rule-of-thirds line, and the diameter is 50–60% of the screen width (R-01).
- Distant galaxies: 3–5 small smudges of 3–8 cells. Stars: a few dozen points, each with its own twinkle period of 5–8 s and phase (R-02, R-04).
- Flares from E03 add a brightness bump to one star (R-05).

## E02 RasterEngine
- Grid: cell width = screen width ÷ 124, clamped to 8–13 px. Cell height = width × 1.45. Grid lines are a very faint grey.
- Each cell samples brightness at 8 points and averages them (for smooth edges).
- The cell background is filled with a grey that follows the brightness. The glyph is chosen from the ramp `` .:;t%SX8#@`` (on white paper, brighter means denser).
- Colour glints: each cell has its own staggered clock. A small share of cells take a faint colour (blue and pink in the arms, amber in the core), re-rolled once every 2–3 s (R-06).

## E03 EventEngine
- Flare: every few minutes (random interval, seeded through U02), pick one star. Its brightness rises and falls over about 20 s (R-05). The event is emitted once, at its start, so M01 can trigger the chime (R-12).

## E04 CompositionEngine: what "chill" means
Chill is treated as sound that asks no tension of the listener. It is built from three things: low tension, comfortable predictability, and a little wobble. Each is made by the rules below. All functions are pure: (state, random source) → notes.

### Harmony: never fully resolve
- Chords have four or more notes (maj7, m7, 9, 11, 13). No plain triads.
- Avoid a strong V7 → I. Return softly through sus4, ♭VII7, or IVm7 instead.
- Progressions are chosen by weight (Markov chain). Candidates, written in C:
  - IVmaj7 → III7 → VIm7 → Vm7 I7: Fmaj7 → E7 → Am7 → Gm7 C7
  - A swaying ii–V–I: Dm9 → G13sus4 → Cmaj9 → A7(♭9)
  - Descending: Fmaj9 → Em7 → Dm9 → Cmaj7
  - Two-chord vamp (Dorian): Dm9 ⇄ G9
- Every 32–64 bars, move to the relative key, a minor third up, or the parallel key.

### Voicing: keep it close
- Upper voices are rootless (3rd, 7th, 9th, 13th) and stay within C3–C5.
- Moving to the next chord, choose the arrangement with the smallest total voice movement.
- Bass plays only the root and fifth, 1–2 octaves below the chord, short.

### Rhythm: lean back
- Tempo 72–84. 16th-note swing at 58%.
- Half-time feel: kick on beat 1 and the "and" of 3, snare on beat 3 (played 15 ms late).
- Timing jitter ±8 ms and velocity jitter ±15%. Chords are strummed from the lowest note up, 12 ms apart.

### Melody: sparse and repeated
- Scale: pentatonic plus the 9th and 13th as colour notes. Range within 1.5 octaves.
- Make a 2-bar motif; repeat it keeping the rhythm while bending its pitches to fit the next chord.
- More than half of the steps are rests. Strong beats use chord tones; weak beats may use passing notes.

### Form: no big peaks
- Every 8 bars, add or remove one layer (pad → electric piano → bass → drums → melody → drop the drums …). Drums do not play all the time.
- Chime (R-12): pick the 9th or 5th of the current key's scale, played once.

## E05 VoiceEngine
Patches are data (oscillators, ratios, envelopes, filter settings); A02 builds the Web Audio graph from them.
- Electric piano: FM with a 1:1 body and a 14:1 metallic partial that decays quickly.
- Bass: sine plus a little second harmonic.
- Pad: two slightly detuned saws through a low-pass filter, slow attack.
- Drums: kick is a sine with a falling pitch; snare and hat are filtered noise. All quiet.
- Chime: FM bell with a non-integer ratio.
- Master chain (built once by A02): low-pass at about 2.5 kHz, gentle saturation, tape wobble (pitch LFO at 0.3 Hz, ±6 cents), vinyl noise (band-limited noise and rare clicks), convolution reverb of about 2.5 s from a decaying-noise impulse response.

## A01 DisplayAccess / A02 AudioAccess
- A01 draws a cell array onto a Canvas 2D context (background fill, then glyphs grouped by colour).
- A02 owns the AudioContext (or an OfflineAudioContext in tests), the master chain, and a look-ahead scheduler (about 100 ms ahead).

## U01 Clock / U02 Random / U03 Pitch
- U01: fixed 1/60 s steps driven by requestAnimationFrame. Modes: live, still (reduced motion), paused (off-screen via IntersectionObserver), fixed (tests).
- U02: a small seeded PRNG, so tests can reproduce the same sky and the same music.
- U03: MIDI ↔ frequency, scales, chord spelling, intervals.

## Verification
| Target | Check | Kind |
|---|---|---|
| E04 harmony | Every generated chord has four or more notes and no strong V7 → I | Unit test |
| E04 voicing | Every voicing stays within C3–C5 | Unit test |
| E04 rhythm | Timing jitter stays within ±8 ms | Unit test |
| E04 melody | The melody never leaves the current scale; more than half of the steps are rests | Unit test |
| R-13 | Render 60 s through OfflineAudioContext: peak ≤ −6 dBFS, spectral centroid ≤ 2 kHz | Browser test (UC-05) |
| R-07 | Screenshots at 1440 px and 390 px, compared side by side with the reference | Visual |
| R-10 | Does it sound chill? | The user listens and decides |

Each automated check is first shown to catch one deliberately broken input before its result is trusted.

## Build order
1. U01–U03, E01, E02, A01: a still galaxy → check by screenshots
2. Rotation, twinkle, colour glints, E03 flares
3. E04 as pure functions with unit tests
4. E05, A02, the "♪" button, the chime
5. Publish to GitHub Pages
