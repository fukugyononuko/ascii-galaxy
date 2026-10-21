# 02 Detailed design

Component IDs are from [01-overview.md](01-overview.md). Each rule has an ID; the Verification section assigns a check to every ID.

## E01 SkyEngine
- SK-1 Brightness field: brightness = core (exponential fall-off with radius) + disc × arm strength.
- SK-2 Arms: a logarithmic-spiral pattern that turns rigidly. One full turn takes 600 s ± 5% (R-03 "about 10 minutes"). Because it turns rigidly, the arm layer at time t + Δ equals the arm layer at t rotated by the pattern angle for Δ (R-03 "the arms keep their shape").
- SK-3 On top of the arms, particle noise flows at an angular speed that decreases with radius (R-03 "the center turns faster than the outside"). Turning the arms themselves differentially would wind them up until they disappear, so the two are kept as separate layers.
- SK-4 Tilt and placement: the galaxy plane is tilted slightly and projected, so it looks elliptical with a minor/major axis ratio in [0.6, 0.85] (on screen, after correcting for the cell aspect); the center sits on a rule-of-thirds line; the diameter is 50–60% of the screen width (R-01).
- SK-5 Distant galaxies: 3–5 smudges of 3–8 cells each. Stars: 30–60 points (R-02).
- SK-6 Each star twinkles with its own period, 5 + 3 × u s, and its own phase, 2π × u′, for uniform u, u′ in [0, 1) from U02 (R-04).
- SK-7 A flare from E03 adds a brightness bump to its star, following the flare's envelope (R-05).

## E02 RasterEngine
- RS-1 Grid: cell width = round(screen width ÷ 124), clamped to 8–13 px. Cell height = round(width × 1.45). Grid lines are a very faint grey.
- RS-2 Each cell samples brightness at 8 fixed points (a constant table of offsets inside the cell, exported for tests) and averages them (for smooth edges).
- RS-3 For a cell brightness b in [0, 1]: the glyph is ramp[min(10, floor(11 × b))] from the 11-glyph ramp `` .:;t%SX8#@`` (index 0 is a space), so brighter means a later, denser glyph; the background is a grey with lightness 1 − 0.25 × b (white paper at b = 0, a light grey at b = 1).
- RS-4 Colour glints: each cell has its own staggered clock with a re-roll interval of 2 + u s for a uniform u in [0, 1) from U02. At any moment, 2–5% of the galaxy's cells (cells with brightness > 0.1) show a faint colour: blue or pink in the arms, amber in the core (R-06).

## E03 EventEngine
- EV-1 Flare intervals are drawn uniformly from [120, 300] s using U02: interval = 120 + 180 × u for a uniform u in [0, 1) (R-05 "every few minutes").
- EV-2 A flare lasts 20 s ± 2 s: it rises for 8 s and fades for 12 s (R-05 "about 20 seconds").
- EV-3 The event is emitted once, at its start, so M01 can trigger the chime (R-12).

## E04 CompositionEngine: what "chill" means
Chill is treated as sound that asks no tension of the listener. It is built from three things: low tension, comfortable predictability, and a little wobble. Each is made by the rules below. All functions are pure: (state, random source) → notes. A style is data (VOL-04); the rules below are the default chill style.

### Harmony: never fully resolve
- H-1 Chords have four or more notes (maj7, m7, 9, 11, 13). No plain triads.
- H-2 The dominant of the current key never resolves to its tonic: no V7 → I (in C: no G7, G9, or G13 → C, Cmaj7, Cmaj9). Return home softly instead: the dominant as sus4 (G13sus4 → Cmaj9), ♭VII7 → I, or IVm7 → I. Secondary dominants that resolve to other chords are part of the style and are allowed (in C: E7 → Am7, A7(♭9) → Dm9, C7 → Fmaj7).
- H-3 H-2 holds on the generated chord sequence: also across the boundary between two progressions and across key changes, where "current key" means the key in force at the second chord. The generator decides each chord one chord ahead: before emitting a chord, it checks it against the next chord (and the key in force there); if the pair would be V7 → I, it emits the sus4 form of that dominant instead.
- H-4 A progression is a 4-bar template, one cell per bar (`|` separates bars). Templates are chosen by weight (Markov chain) from these candidates, written in C:
  - IVmaj7 → III7 → VIm7 → Vm7 I7: | Fmaj7 | E7 | Am7 | Gm7 C7 | (the last bar holds two chords, two beats each)
  - A swaying ii–V–I: | Dm9 | G13sus4 | Cmaj9 | A7(♭9) |
  - Descending: | Fmaj9 | Em7 | Dm9 | Cmaj7 |
  - Two-chord vamp (Dorian): | Dm9 | G9 | Dm9 | G9 |
  Each generated progression starts on a bar that is a multiple of 4 (counting from 0) and equals one template transposed to the current key, except where H-3 replaced a dominant by its sus4 form.
- H-5 Key changes happen at progression starts, 32–64 bars apart (both ends included), to the relative key, a minor third up, or the parallel key. The gap is 32 + 4 × floor(9 × u) bars for a uniform u in [0, 1) from U02.

### Voicing: keep it close
- V-1 Upper voices are rootless. Each upper voice's pitch class is one of the chord's allowed tones: the 3rd (the 4th on a sus4 chord), the 7th, the 9th (♭9 where the chord name says so), the 5th, or the 13th. The 3rd (or 4th) and the 7th are always present; the root's pitch class never is.
- V-2 Upper voices stay within C3–C5 (MIDI 48–72).
- V-3 Moving to the next chord, the chosen voicing has the smallest total voice movement among all voicings that satisfy V-1 and V-2.
- V-4 Bass plays only the root or the fifth, 12–24 semitones below the lowest upper voice, and each bass note lasts at most one beat.

### Rhythm: lean back
- RH-1 Tempo is chosen at the start and at each key change: BPM = 72 + 12 × u for a uniform u in [0, 1) from U02.
- RH-2 16th-note swing at 58%: every off-beat 16th starts at 58% of its 8th-note span.
- RH-3 Half-time feel: kick on beat 1 and the "and" of 3; snare on beat 3, played 15 ms late.
- RH-4 Timing offset = −8 + 16 × u ms and velocity factor = 0.85 + 0.30 × u′, for uniform u, u′ in [0, 1) from U02, drawn per note (the wobble is part of the style).
- RH-5 Chords are strummed from the lowest note up, 12 ms apart.

### Melody: sparse and repeated
- M-1 Scale: the key's pentatonic plus the 9th and 13th as colour notes.
- M-2 Range: within 18 semitones (1.5 octaves) over each 8-bar phrase.
- M-3 A 2-bar motif is made at the start of each 8-bar phrase; the other three 2-bar blocks of the phrase keep its onset rhythm, with pitches bent to fit their chords.
- M-4 More than half of the 16th steps are rests. Notes on beats 1 and 3 are chord tones; other notes may be passing notes within M-1.

### Form: no big peaks
- F-1 Layers change only at 8-bar phrase boundaries, one layer at a time, following this list of phrases (P = pad, E = electric piano, B = bass, D = drums, M = melody). Phrases 1–2 are the intro; phrases 3–10 then repeat in order (10 → 3 adds B).
  1 P · 2 P E · 3 P E B · 4 P E B D · 5 P E B D M · 6 P E B M · 7 P E B D M · 8 P E B M · 9 P E M · 10 P E
- F-2 Drums do not play all the time: no more than 4 consecutive 8-bar phrases with drums.
- F-3 Chime (R-12): exactly one note per flare, either the 5th (tonic + 7 semitones) or the 9th (tonic + 14 semitones), where the tonic is the current key's tonic in octave 5 (MIDI 72–83).

## E05 VoiceEngine
Patches are data (oscillators, ratios, envelopes, filter settings); A02 builds the Web Audio graph from them. The master chain is also data (a list of stages with parameters) that A02 builds once.

### Timbre
- T-1 Electric piano: two FM pairs on the note frequency. Body: carrier and modulator at ratio 1:1. Tine: modulator at ratio 14:1 whose modulation decays to 10% within 0.3 s.
- T-2 Bass: a sine at the note frequency plus its second harmonic at a gain of 0.1–0.3.
- T-3 Pad: two sawtooth oscillators detuned by ±3 to ±10 cents, through a low-pass filter with cutoff ≤ 2 kHz; attack ≥ 0.5 s.
- T-4 Drums: kick is a sine whose pitch falls from ≥ 100 Hz to ≤ 60 Hz within 100 ms; snare is noise through a band-pass filter (center 1–3 kHz); hat is noise through a high-pass filter (cutoff ≥ 5 kHz) at a gain at least 12 dB below the snare.
- T-5 Chime: FM with a non-integer carrier/modulator ratio (not within 0.05 of an integer).

### Master chain
- MC-1 Order: low-pass → saturation → tape wobble → reverb → output; vinyl noise is mixed in after the reverb.
- MC-2 Low-pass cutoff 2.5 kHz ± 10%.
- MC-3 Saturation: a tanh-shaped curve with drive ≤ 2 (gentle).
- MC-4 Tape wobble: a pitch LFO at 0.3 Hz ± 0.05 with depth 6 cents ± 1.
- MC-5 Vinyl noise: band-limited noise (200 Hz–4 kHz) at ≤ −45 dBFS, plus clicks at 0.1–0.5 per second on average.
- MC-6 Reverb: convolution with an impulse response of decaying noise whose level falls by 60 dB in 2.5 s ± 0.2.

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
Every rule ID above, and C-1–C-4 from 01 §2, has a row. Unless stated otherwise, unit tests run 5 seeds; "30 minutes" means the bars of 30 minutes of music generated by E04 without audio, at fixed time (U01 fixed). "u fixed to 0, 0.5, 0.999" means the test replaces U02 with a stub returning that value and checks the exact result of the formula.

### Core (unit tests)
| Rule | Check |
|---|---|
| C-1 | The cell type holds exactly one glyph (a string of length 1) or none; A01 draws one glyph per cell at most (a canvas spy counts fillText calls per cell) |
| C-2 | E01 values over 100 random times (flare peaks included) are all in [0, 1]; E02 maps −0.5 to the same cell as 0 and 1.5 to the same cell as 1 |
| C-3 | U03: MIDI 69 → 440 Hz, 60 → 261.63 Hz (± 0.01), 81 → 880 Hz; frequency → MIDI is the inverse |
| C-4 | A bar has 16 steps; at 72 and 84 BPM one step lasts 60 / BPM / 4 s |

### Sky and events (unit tests at fixed times)
| Rule | Check |
|---|---|
| SK-1 | The field is highest at the center and falls off with radius along any ray outside the arms |
| SK-2 | The pattern angle advances 360° in 600 s ± 5%; the arm layer at t + 60 s equals the arm layer at t rotated by that angle (correlation ≥ 0.99) |
| SK-3 | Measured angular speed of the noise layer strictly decreases from the inner third to the outer third of the radius |
| SK-4 | At 1440 × 900 and 390 × 844: center on a third line (± one cell), diameter 50–60% of the width, on-screen minor/major axis ratio in [0.6, 0.85] |
| SK-5 | Counts of distant galaxies (3–5), their sizes (3–8 cells), and stars (30–60) |
| SK-6 | With u fixed to 0, 0.5, 0.999: periods of 5, 6.5, 7.997 s. With real seeds: each star's measured brightness period over 60 s matches its period; periods cover both halves of [5, 8]; no two stars share both period and phase |
| SK-7 | During a flare, its star's brightness follows the EV-2 envelope; outside flares it does not |
| RS-1 | Cell widths 8, 8, 12, 13 px and heights 12, 12, 17, 19 px at screen widths 390, 1024, 1440, 2560 px |
| RS-2 | The offset table has exactly 8 entries, all inside the cell; a cell's value equals the mean of the field at those 8 points |
| RS-3 | b = 0, 0.05, 0.5, 0.95, 1 give glyphs " ", " ", "%", "@", "@" and background lightness 1, 0.9875, 0.875, 0.7625, 0.75; −0.5 and 1.5 behave as 0 and 1 (C-2) |
| RS-4 | With u fixed to 0, 0.5, 0.999: re-roll intervals of 2, 2.5, 2.999 s. With real seeds: intervals cover both halves of [2, 3]; at 100 sampled times, 2–5% of cells with brightness > 0.1 are coloured; blue and pink appear only in arm cells and amber only in core cells |
| EV-1 | With u fixed to 0, 0.5, 0.999: intervals of 120, 210, and 299.82 s. With real seeds over 2 hours: every interval in [120, 300] s, and both halves of the range occur |
| EV-2 | Every flare lasts 20 s ± 2 s (8 s rise, 12 s fade) |
| EV-3 | Each flare emits exactly one event, at its start |

### Music (unit tests over 30 minutes)
| Rule | Check |
|---|---|
| H-1 | Every chord has four or more notes |
| H-2, H-3 | No pair of consecutive chords is V7 → I in the key in force at the second chord, including at progression boundaries and key changes |
| H-4 | The bars are split into 4-bar progressions starting at multiples of 4; each equals one template transposed to the current key, bar by bar and chord by chord, allowing only H-3's sus4 replacements |
| H-5 | With u fixed to 0, 0.5, 0.999: gaps of 32, 48, and 64 bars. With real seeds: every gap is 32–64 bars (so no stretch longer than 64 bars without a change), each change starts a progression, and each target is the relative key, a minor third up, or the parallel key |
| V-1 | Every upper voice's pitch class is one of the chord's allowed tones (3rd or sus 4th, 7th, 9th or written ♭9, 5th, 13th); the 3rd (or 4th) and 7th are present; the root's pitch class is absent. Rejects e.g. a Cmaj7 voicing that contains F♯ or A♭ |
| V-2 | Every upper voice is in MIDI 48–72 |
| V-3 | For each chord change, no other voicing satisfying V-1 and V-2 has a smaller total movement (checked by enumerating them) |
| V-4 | Every bass note is the root or fifth, 12–24 semitones below the lowest upper voice, and at most one beat long |
| RH-1 | With u fixed to 0, 0.5, 0.999: 72, 78, and 83.988 BPM. With real seeds: every tempo in [72, 84], set at the start and changed only at key changes |
| RH-2 | Every off-beat 16th (before jitter) starts at 58% of its 8th-note span |
| RH-3 | In every bar with drums: a kick on beat 1 and on the "and" of 3, a snare on beat 3 played 15 ms late (before jitter), and no kick or snare anywhere else |
| RH-4 | With u fixed to 0, 0.5, 0.999: offsets of −8, 0, 7.984 ms and velocity factors 0.85, 1.0, 1.1497. With real seeds over 30 minutes: split each range into 8 equal bins; every bin holds 12.5% ± 3% of the notes (an alternating ±4 ms pattern fills only 2 bins and fails) |
| RH-5 | Each chord's notes start from the lowest up, 12 ms apart |
| M-1 | Every melody note is in the scale of the current key |
| M-2 | Every phrase's melody range is ≤ 18 semitones |
| M-3 | In every phrase, the three later 2-bar blocks have the same onset rhythm as the first |
| M-4 | More than half of the steps are rests; notes on beats 1 and 3 are chord tones |
| F-1 | The sequence of layer sets, one per phrase, equals the list in F-1 (phrases 1–10, then 3–10 repeated), and the layer set never changes inside a phrase |
| F-2 | Never more than 4 consecutive phrases with drums; drums appear at least once |
| F-3 | Every chime call returns exactly one note, whose MIDI number is the current key's tonic in octave 5 plus 7 or plus 14, also right after a key change |
| R-10 | Every bar from 1 to the end is produced with no gap, and no 16-bar window of notes (all layers together) appears twice |

### Timbre and master chain (unit tests on patch and chain data)
| Rule | Check |
|---|---|
| T-1 | The electric piano patch has two FM pairs at ratios 1:1 and 14:1; the 14:1 modulation envelope is ≤ 10% at 0.3 s |
| T-2 | The bass patch is a sine plus the 2nd harmonic with gain in [0.1, 0.3] |
| T-3 | The pad patch has two sawtooths detuned within ±3 to ±10 cents, a low-pass ≤ 2 kHz, attack ≥ 0.5 s |
| T-4 | Kick pitch ≥ 100 Hz at 0 ms and ≤ 60 Hz at 100 ms; snare band-pass center in 1–3 kHz; hat high-pass ≥ 5 kHz and gain ≥ 12 dB below the snare |
| T-5 | The chime's ratio is at least 0.05 away from every integer |
| MC-1 | The chain description lists the stages in the stated order, vinyl noise after the reverb; a browser test checks the built node graph has the same order |
| MC-2–MC-6 | Each stage's parameters are within the stated ranges; the reverb impulse response, measured, falls by 60 dB in 2.5 s ± 0.2 |

### Sound output (browser tests through OfflineAudioContext, UC-05)
| Rule | Check |
|---|---|
| L-1 | Every patch E05 produces (all instruments, the chime) has attack ≥ 5 ms and release ≥ 30 ms (unit test) |
| L-2–L-4 | **Forced render:** a test style with every layer on from bar 1, a flare forced at 10 s and 40 s (chime), and vinyl clicks forced every 5 s, rendered for 60 s. Every source the master chain can play sounds in it. Every limit in L-2–L-4 is checked |
| L-2–L-4 | **Natural render:** the default style for 6 minutes with 2 seeds, long enough to pass through every phrase of F-1 (at 72 BPM, the slowest tempo, the 10 phrases take 80 bars, about 267 s). Every limit is checked |

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
