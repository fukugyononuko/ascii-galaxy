# 02 Detailed design

Component IDs are from [01-overview.md](01-overview.md). Each rule has an ID; the Verification section assigns a check to every ID.

## E01 SkyEngine
- SK-1 Brightness field: brightness = core (exponential fall-off with radius) + disc × arm strength.
- SK-2 Arms: a logarithmic-spiral pattern that turns rigidly. One full turn takes 600 s ± 5% (R-03 "about 10 minutes"). Because it turns rigidly, the arm layer at time t + Δ equals the arm layer at t rotated by the pattern angle for Δ (R-03 "the arms keep their shape").
- SK-3 On top of the arms, particle noise flows at an angular speed that decreases with radius (R-03 "the center turns faster than the outside"). Turning the arms themselves differentially would wind them up until they disappear, so the two are kept as separate layers.
- SK-4 Tilt and placement: the galaxy plane is tilted and projected, so it looks elliptical; the center sits on a rule-of-thirds line; the diameter is 50–60% of the screen width (R-01).
- SK-5 Distant galaxies: 3–5 smudges of 3–8 cells each. Stars: 30–60 points (R-02).
- SK-6 Each star twinkles with its own period, drawn from [5, 8] s, and its own phase (R-04).
- SK-7 A flare from E03 adds a brightness bump to its star, following the flare's envelope (R-05).

## E02 RasterEngine
- RS-1 Grid: cell width = screen width ÷ 124, clamped to 8–13 px. Cell height = width × 1.45. Grid lines are a very faint grey.
- RS-2 Each cell samples brightness at 8 points and averages them (for smooth edges).
- RS-3 The cell background is filled with a grey that follows the brightness. The glyph is chosen from the ramp `` .:;t%SX8#@``; brighter means a later (denser) glyph.
- RS-4 Colour glints: each cell has its own staggered clock with a re-roll interval drawn from [2, 3] s. On each re-roll, a small share of cells take a faint colour: blue or pink in the arms, amber in the core (R-06).

## E03 EventEngine
- EV-1 Flare intervals are drawn uniformly from [120, 300] s using U02 (R-05 "every few minutes").
- EV-2 A flare lasts 20 s ± 2 s: it rises for 8 s and fades for 12 s (R-05 "about 20 seconds").
- EV-3 The event is emitted once, at its start, so M01 can trigger the chime (R-12).

## E04 CompositionEngine: what "chill" means
Chill is treated as sound that asks no tension of the listener. It is built from three things: low tension, comfortable predictability, and a little wobble. Each is made by the rules below. All functions are pure: (state, random source) → notes. A style is data (VOL-04); the rules below are the default chill style.

### Harmony: never fully resolve
- H-1 Chords have four or more notes (maj7, m7, 9, 11, 13). No plain triads.
- H-2 The dominant of the current key never resolves to its tonic: no V7 → I (in C: no G7, G9, or G13 → C, Cmaj7, Cmaj9). Return home softly instead: the dominant as sus4 (G13sus4 → Cmaj9), ♭VII7 → I, or IVm7 → I. Secondary dominants that resolve to other chords are part of the style and are allowed (in C: E7 → Am7, A7(♭9) → Dm9, C7 → Fmaj7).
- H-3 H-2 holds on the generated chord sequence: also across the boundary between two progressions and across key changes, where "current key" means the key in force at the second chord. The generator decides each chord one chord ahead: before emitting a chord, it checks it against the next chord (and the key in force there); if the pair would be V7 → I, it emits the sus4 form of that dominant instead.
- H-4 Progressions are chosen by weight (Markov chain) from these candidates, written in C:
  - IVmaj7 → III7 → VIm7 → Vm7 I7: Fmaj7 → E7 → Am7 → Gm7 C7
  - A swaying ii–V–I: Dm9 → G13sus4 → Cmaj9 → A7(♭9)
  - Descending: Fmaj9 → Em7 → Dm9 → Cmaj7
  - Two-chord vamp (Dorian): Dm9 ⇄ G9
- H-5 Key changes happen every 32–64 bars, to the relative key, a minor third up, or the parallel key.

### Voicing: keep it close
- V-1 Upper voices are rootless: they hold the 3rd, 7th, and color tones (9th, 13th), never the root's pitch class.
- V-2 Upper voices stay within C3–C5 (MIDI 48–72).
- V-3 Moving to the next chord, the chosen voicing has the smallest total voice movement among all voicings that satisfy V-1 and V-2.
- V-4 Bass plays only the root or the fifth, 12–24 semitones below the lowest upper voice, and each bass note lasts at most one beat.

### Rhythm: lean back
- RH-1 Tempo is chosen from [72, 84] BPM at each key change.
- RH-2 16th-note swing at 58%: every off-beat 16th starts at 58% of its 8th-note span.
- RH-3 Half-time feel: kick on beat 1 and the "and" of 3; snare on beat 3, played 15 ms late.
- RH-4 Timing jitter within ±8 ms and velocity jitter within ±15% of the nominal values.
- RH-5 Chords are strummed from the lowest note up, 12 ms apart.

### Melody: sparse and repeated
- M-1 Scale: the key's pentatonic plus the 9th and 13th as colour notes.
- M-2 Range: within 18 semitones (1.5 octaves) over each 8-bar phrase.
- M-3 A 2-bar motif is made at the start of each 8-bar phrase; the other three 2-bar blocks of the phrase keep its onset rhythm, with pitches bent to fit their chords.
- M-4 More than half of the 16th steps are rests. Notes on beats 1 and 3 are chord tones; other notes may be passing notes within M-1.

### Form: no big peaks
- F-1 At each 8-bar boundary, exactly one layer is added or removed, in the cycle pad → electric piano → bass → drums → melody → drop the drums …; layers change at no other time.
- F-2 Drums do not play all the time: no more than 4 consecutive 8-bar phrases with drums.
- F-3 Chime (R-12): the 9th (the 2nd scale degree, an octave up) or the 5th of the current key, played once.

## E05 VoiceEngine
Patches are data (oscillators, ratios, envelopes, filter settings); A02 builds the Web Audio graph from them.
- Electric piano: FM with a 1:1 body and a 14:1 metallic partial that decays quickly.
- Bass: sine plus a little second harmonic.
- Pad: two slightly detuned saws through a low-pass filter, slow attack.
- Drums: kick is a sine with a falling pitch; snare and hat are filtered noise. All quiet.
- Chime: FM bell with a non-integer ratio.
- Master chain (built once by A02): low-pass at about 2.5 kHz, gentle saturation, tape wobble (pitch LFO at 0.3 Hz, ±6 cents), vinyl noise (band-limited noise and rare clicks), convolution reverb of about 2.5 s from a decaying-noise impulse response.

### Loudness limits (R-13)
These numbers are the limits R-13 refers to. They may be tuned in build step 4 only by a PR that changes this section.
- L-1 Every patch envelope has an attack of at least 5 ms (drums included) and a release of at least 30 ms.
- L-2 The master output fades in over 4 s after "♪" is pressed.
- L-3 Measured on the rendered output in 100 ms windows: peak ≤ −6 dBFS in every window; spectral centroid ≤ 3 kHz in every window and ≤ 2 kHz over the whole render.
- L-4 Momentary loudness (400 ms windows, 100 ms hop) never rises by more than 10 dB from one window to the next, after the fade-in.

## A01 DisplayAccess / A02 AudioAccess
- A01 draws a cell array onto a Canvas 2D context (background fill, then glyphs grouped by colour).
- A02 owns the AudioContext (or an OfflineAudioContext in tests), the master chain, and a look-ahead scheduler (about 100 ms ahead).

## U01 Clock / U02 Random / U03 Pitch
- U01: pure. Turns the frame times that C01 passes in (from requestAnimationFrame) into fixed 1/60 s steps. Modes: live, still (reduced motion), paused (off-screen), fixed (tests). C01 sets the mode from matchMedia and IntersectionObserver; U01 itself uses no browser API.
- U02: a small seeded PRNG, so tests can reproduce the same sky and the same music.
- U03: MIDI ↔ frequency, scales, chord spelling, intervals.

## Verification
Every rule ID above has a row. Unless stated otherwise, unit tests run 5 seeds; "30 minutes" means the bars of 30 minutes of music generated by E04 without audio, at fixed time (U01 fixed).

### Sky and events (unit tests at fixed times)
| Rule | Check |
|---|---|
| SK-1 | The field is highest at the center and falls off with radius along any ray outside the arms |
| SK-2 | The pattern angle advances 360° in 600 s ± 5%; the arm layer at t + 60 s equals the arm layer at t rotated by that angle (correlation ≥ 0.99) |
| SK-3 | Measured angular speed of the noise layer strictly decreases from the inner third to the outer third of the radius |
| SK-4 | At 1440 × 900 and 390 × 844: center on a third line (± one cell), diameter 50–60% of the width, projected minor/major axis < 1 |
| SK-5 | Counts of distant galaxies (3–5), their sizes (3–8 cells), and stars (30–60) |
| SK-6 | Each star's brightness over 60 s has a period in [5, 8] s; no two stars share both period and phase |
| SK-7 | During a flare, its star's brightness follows the EV-2 envelope; outside flares it does not |
| RS-1 | Cell size at 390, 1024, 1440, and 2560 px widths |
| RS-2 | A half-covered cell gets about half the brightness of a fully covered one |
| RS-3 | The glyph index is non-decreasing in brightness |
| RS-4 | Each cell's re-roll interval is in [2, 3] s; glint colours appear only in the regions named |
| EV-1 | Over 30 minutes, every interval between flares is in [120, 300] s |
| EV-2 | Every flare lasts 20 s ± 2 s (8 s rise, 12 s fade) |
| EV-3 | Each flare emits exactly one event, at its start |

### Music (unit tests over 30 minutes)
| Rule | Check |
|---|---|
| H-1 | Every chord has four or more notes |
| H-2, H-3 | No pair of consecutive chords is V7 → I in the key in force at the second chord, including at progression boundaries and key changes |
| H-4 | Every 4-chord window inside a progression matches one of the candidates, transposed to the current key |
| H-5 | Every key change comes 32–64 bars after the previous one and goes to the relative key, a minor third up, or the parallel key |
| V-1, V-2 | No upper voice has the root's pitch class; every upper voice is in MIDI 48–72 |
| V-3 | For each chord change, no other voicing satisfying V-1 and V-2 has a smaller total movement (checked by enumerating them) |
| V-4 | Every bass note is the root or fifth, 12–24 semitones below the lowest upper voice, and at most one beat long |
| RH-1 | Every tempo is in [72, 84] and changes only at key changes |
| RH-2 | Every off-beat 16th (before jitter) starts at 58% of its 8th-note span |
| RH-3 | Kicks only on beat 1 and the "and" of 3; snares only on beat 3, 15 ms late (before jitter) |
| RH-4 | Every onset is within ±8 ms and every velocity within ±15% of its nominal value |
| RH-5 | Each chord's notes start from the lowest up, 12 ms apart |
| M-1 | Every melody note is in the scale of the current key |
| M-2 | Every phrase's melody range is ≤ 18 semitones |
| M-3 | In every phrase, the three later 2-bar blocks have the same onset rhythm as the first |
| M-4 | More than half of the steps are rests; notes on beats 1 and 3 are chord tones |
| F-1 | Layer sets differ by exactly one layer across each 8-bar boundary and never change inside a phrase |
| F-2 | Never more than 4 consecutive phrases with drums; drums appear at least once |
| F-3 | Every chime's pitch class is the current key's 2nd degree or 5th, also right after a key change |
| R-10 | Every bar from 1 to the end is produced with no gap, and no 16-bar window of notes (all layers together) appears twice |

### Sound output (browser tests through OfflineAudioContext, UC-05)
| Rule | Check |
|---|---|
| L-1 | Every patch E05 produces (all instruments, the chime) has attack ≥ 5 ms and release ≥ 30 ms (unit test) |
| L-2–L-4 | **Forced render:** a test style with every layer on from bar 1, a flare forced at 10 s and 40 s (chime), and vinyl clicks forced every 5 s, rendered for 60 s. Every source the master chain can play sounds in it. Every limit in L-2–L-4 is checked |
| L-2–L-4 | **Natural render:** the default style for 6 minutes with 2 seeds, long enough to pass through every layer of F-1 (at 72 BPM, the slowest tempo, the melody enters at bar 33, about 107 s in). Every limit is checked |

### Browser boundary (browser tests)
| Requirement | Check |
|---|---|
| R-08 | With prefers-reduced-motion emulated, A01 draws exactly once in 3 s. With the canvas scrolled out of view, A01 draws nothing for 2 s, and drawing resumes when it comes back |
| R-11 | Before the button is pressed, no AudioContext has been created. Within 1 s after pressing it, the AudioContext is running and at least one note is scheduled. The page has exactly one interactive element, the "♪" button |

### Visual and listening
| Requirement | Check |
|---|---|
| R-01, R-02, R-06, R-07 | Screenshots at 1440 px and 390 px, compared side by side with the reference |
| R-10 (feel) | Does it sound chill? The user listens and decides |

Each automated check is first shown to catch one deliberately broken input before its result is trusted.

## Build order
1. U01–U03, E01, E02, A01, `index.html`: a still galaxy → check by screenshots; add the build to CI (#2)
2. Rotation, twinkle, colour glints, E03 flares
3. E04 as pure functions with unit tests
4. E05, A02, the "♪" button, the chime
5. Publish to GitHub Pages; add `check:workflows` (R-21) with the Pages workflow
