# Render-Challenge Proposals — Claude (Fable 5), 2026-08-02

**Responding to:** <https://maldoror.dev/render-challenge.md> (v `vf38239c-dirty-v344`)
**Method:** direct source audit of the deployed tree + `ssh2@1.17.0` internals; Ghostty source audit at commit `46edeee407` (cloned, grepped — not docs-trusted); OpenSSH-portable, RFC 4253/4254, Linux kernel sources; Mosh paper + `transportsender-impl.h` / `terminaldisplay.cc`; tmux `tty.c`; notcurses `render.c` / `TERMINALS.md`; ncurses `lib_mvcur.c` / `hashmap.c`; Tribes networking paper; AoI literature. Every capability claim below was independently re-verified against primary source by an adversarial second pass; corrections from that pass are incorporated.
**Labels:** FACT = verified in source/spec this session · INFERENCE = derived from verified facts · HYPOTHESIS = needs the stated experiment.

---

## 0. Ground truth this document builds on

### 0.1 What the deployed tree already does (beyond challenge §6 — do not re-propose)

- **A CPR barrier already exists** (uncommitted, in the `-dirty` deploy): `apps/ssh-world/src/server/terminal-applied-barrier.ts` appends `ESC 7 CSI 1;1 H CSI 6 n ESC 8` to ordinary/keyframe packets, single-flight, capability-probed (30 s first-timeout → `unsupported`), CPR stripped from input, RTT recorded. It is **telemetry-only**: acks do not drive encoding (`session-proxy.ts:180,192`; comment at `terminal-applied-barrier.ts:69-70`).
- Synchronized output `CSI ?2026 h/l` already wraps every frame (`pixel-game-renderer.ts:42-43,748,1505,1607`).
- OSC 4 infrastructure already live: palette-cycled material animation (bands 192–223, `palette-cycle.ts`), OSC 4 query + reply parsing + OSC 104 restore at init (`pixel-game-renderer.ts:406-408,440-490`).
- Codec already emits: DECLRMM(`?69h`)+DECSTBM+DECSLRM margins, SU/SD vertical scroll, per-row DCH/ICH horizontal scroll, REP (runs ≥4), truecolor SGR with cross-run fg/bg state tracking, indexed SGR (`38;5`/`48;5`), relative CUF, and a byte-exact stable-gap-merge (`terminal-codec.ts`).
- Transport already bounds: 64 KiB / 1-frame replaceable app queue; 256 KiB SSH-credit outstanding cap read from `channel.outgoing.window`; recovery keyframes rendered fresh only when writable; presentation pause IPC to the worker (`output-pump.ts`, `session-proxy.ts:103-234`).
- Tonight's run tree (`/mnt/donto-data/donto-resources/maldoror/rendering-research/track-7-performance/2026-08-02-ultra-network-latency-v344/`, 9 sub-runs) shows the terminal-barrier build's cold first-visible at 240 ms/64 kbit/s collapsed **8,709.8 ms → 334.1 ms** (host not qualified: ioFull 6.85). Baseline of record (`tools/render-sim/GOAL.md`): cold keyframe **270,069 raw bytes** at 160×46; idle 6 s = 16,133 B; one step = 16,748 B; observed whole-session zlib factors **0.15–0.28**.

### 0.2 Capability verdicts that reshape the challenge's own tracks (all FACT, Ghostty `46edeee407`)

| Challenge assumption | Verdict in Ghostty source |
|---|---|
| Track A: "DECRQCRA may provide a stronger ack" | **Not implemented.** No `*y` CSI handler exists. CPR (`CSI 6 n`) is the only ack primitive. |
| DECXCPR (`CSI ?6 n`) as a disambiguated CPR | **Not implemented — silently ignored** (`cursor_position` registered only without `?`). Probe with plain `6 n` only. |
| Track D: DECCRA / DECFRA / DECERA rectangles | **Not implemented.** DA1 = `ESC[?62;22;52c` — "we quack as a VT220", deliberately not a VT420. |
| SL/SR (`CSI Ps SP @` / `SP A`) one-shot horizontal region scroll | **Not implemented** — both log "ignoring unimplemented CSI @/A with intermediates" (`stream.zig:2331,1239`). The codec's per-row DCH/ICH loop stands. |
| Track E: does OSC 4 mutation recolor cells already on screen? | **Yes.** Cell styles store the palette *index* (`style.zig:44-54`, comment: "so we can properly react to things like palette changes"); RGB resolves at render time against the live palette; OSC 4 set marks `dirty.palette` → full re-render. OSC 4 `?` query answered (16-bit/channel by default; **config `osc-color-report-format=none` silently drops queries** — probes must be fenced). |
| Track F: mode 2026 semantics | Supported, DECRQM-queryable (`CSI ?2026$p`). **Hard 1000 ms auto-reset timer**; plain boolean (no nesting); parser/replies/screen-model continue during sync — only compositing defers (`renderer/generic.zig:1173-1176`). |
| Track G: Kitty graphics | Actions `q/t/T/p/d` + chunked base64 + Unicode placeholders implemented; **animation actions parse but return "unimplemented"**; 320 MB storage, oldest-evicted. `CSI 16 t` reports cell pixel geometry for exact placement math. |
| CPR timing semantics | Reply is generated **inline during the mutex-held sequential parse** of the PTY buffer and reads live cursor state → a CPR ack proves *all prior bytes are applied to the screen model* (true parse/apply barrier). It does **not** prove GPU presentation; renderer snapshots between ≤64 KiB parse batches. DECOM makes CPR origin-relative — pin DECOM off. Replies flow even inside mode 2026. |
| Capability fingerprint | XTVERSION → `DCS >|ghostty {version} ST` (says "ghostty" verbatim — the best identity probe). XTGETTCAP serves the whole terminfo, `TN` returns hex of **`xterm-ghostty`** (not `ghostty`); **unknown keys are silently skipped (no negative reply)** — every probe burst must end with a guaranteed responder (DA1 or CPR) as a fence. Mode 2048 in-band size reports + `CSI 14/16/18 t` are available. DECRQSS can read back SGR/DECSTBM/DECSLRM. |

### 0.3 Transport ground truth (FACT unless noted)

- OpenSSH client: session-channel window **2 MiB**, maxpacket **32 KiB** (`channels.h` `CHAN_SES_*`). It sends `WINDOW_ADJUST` only when `local_consumed > 0` AND (window deficit > 3×maxpacket [=96 KiB] OR window < half) — and **"consumed" means bytes written to the tty fd** (`channel_handle_wfd`). So credit return is a *tty-drain* signal at ~96 KiB granularity — coarser than a frame, but monotone truth about client-side progress that costs nothing.
- Client-side hiding places beyond the window signal: up to ~2 MiB in the client channel buffer + ~640 KiB kernel pty flip buffer (`TTYB_DEFAULT_MEM_LIMIT`).
- `zlib@openssh.com` is ONE stateful deflate stream per direction for the whole connection, `Z_PARTIAL_FLUSH` per packet, **windowBits 15 → LZ77 only matches the last 32 KiB of raw output** (ssh2 `zlib.js:44-47,89`). Repetition farther back than 32 KiB of emitted bytes only helps via Huffman statistics. Compression runs **synchronously on the coordinator event loop**.
- ssh2@1.17.0: `Channel` duplex `highWaterMark = 2 MiB` → `stream.write() === false` (and `'drain'`) is nearly inert as backpressure; the credit gate is the only real regulator. `CHANNEL_WINDOW_ADJUST` replenishes `outgoing.window` **with no userland event** (hence the pump's blind 8 ms poll). During rekey, ssh2 diverts all packets into an **unbounded array**; `socket.write()`'s return value is **discarded** (socket-level backpressure invisible). Write path slices frames into `min(window, 32 KiB)` CHANNEL_DATA packets.
- OpenSSH ≥ 9.5 `ObscureKeystrokeTiming` is **on by default, 20 ms interval**: all client→server tty bytes — keystrokes *and terminal replies, including CPR acks* — are released on a ~20 ms quantized clock (±10 % fuzz). Chaff (SSH2_MSG_PING) requires the server to advertise `ping@openssh.com`, which ssh2 never does — so **no chaff arrives, but the quantization persists**. Every "input →" and "ack →" measurement has a ~0–22 ms client-side noise floor that no server work can remove. (INFERENCE from verified `clientloop.c` + ssh2 grep.)
- Live flow evidence (this session, `ss -ti` on :2222, peer in Australia): rtt 238–244 ms / minrtt 232, mss 1460; **cwnd oscillates** — observed pinned at 10 after idle and at 80 during sustained transfer; box has `tcp_slow_start_after_idle = 1`, so **every post-idle burst (keyframe after quiet, modal open) re-pays slow-start**: a ~50 KB wire keyframe from cwnd 10 ≈ 14.6 KB costs ~2–3 extra RTTs. Box `iproute2` supports per-route `initcwnd`/`initrwnd`/`quickack`/`congctl`.
- Cold-login protocol floor with the current publickey flow: **~7–8 RTTs** before the first world byte (TCP + banner/KEXINIT + ECDH/NEWKEYS + service + none-probe + pk-query + pk-sign + channel/pty/shell), ≈ 1.7–1.9 s at 240 ms before any server work. ssh2 accepts `none` auth server-side if the handler allows it.

### 0.4 The theory frame (from prior art, for the admission controller)

- Maldoror's OutputPump ("at most one waiting frame, always replaced by the freshest") is literally the **M/M/1/2\*** discipline that the Age-of-Information literature proves near-optimal for freshness (Costa/Codreanu/Ephremides, ISIT'14/TIT'16). The theory adds two non-obvious refinements: (1) **age is minimized well below full utilization** (Kaul/Yates/Gruteser 2012: ρ\* ≈ 0.53 for M/M/1 — don't saturate the pipe); (2) **zero-wait is not always optimal** ("Update or Wait", Sun et al. 2016): when service times are positively correlated — and SSH frame service times are (stateful zlib, cwnd, bufferbloat) — a small deliberate wait before *sampling* beats greedy sends. Mosh's empirically-derived 8 ms collection interval is an independent instance of the same result.
- Mosh SSP's sender is the design to copy server-side: diff from the last *acked* state, ≈ one instruction in flight (`send_interval = clamp(SRTT/2)`), 8 ms collection delay, skip intermediate states, prospective-resend re-based on an older state when cheaper, ≤32 retained states (`transportsender-impl.h`). None of that needs UDP; UDP is only needed for (a) dropping bytes already sent, (b) loss-recovery outside stream order, (c) roaming.

---

## 1. Ranked proposal index

| # | Proposal | Main gain | Risk | Proof cost |
|---|---|---|---|---|
| P1 | Applied-base convergence transport (SSP-over-PTY; finishes Track A) | tail latency + thin-link exactness; kills keyframe storms | medium | medium |
| P2 | Admission-before-render + AoI pacing (Track B) | server-added latency → ~0; no wasted render/IPC | low | low |
| P3 | Cold-login program: overlap, pre-encoded origin, progressive exact paint (Track K) | cold 8.7 s → ~handshake+1 s | low-med | medium |
| P4 | Palette-register exact color compression + palette lighting (Track E) | bandwidth (esp. keyframes/weather) | medium | low |
| P5 | Codec upgrades from prior art: dirty-offsets, row-hash scroll discovery, ECH, tile hashes + per-session dirty masks (Tracks D/L) | CPU + bandwidth + partial-recovery | low | medium |
| P6 | Wire-cost telemetry inside ssh2 + compression-aware encoding decisions (Track H) | makes every other byte claim measurable | low | low |
| P7 | Kernel/socket program: TCP_INFO, TCP_NOTSENT_LOWAT, per-route initcwnd, BBR (Tracks I/J) | post-idle bursts, byte-age bound, cold keyframe RTTs | low-med | low |
| P8 | IPC + process isolation: advanced serialization, buffer frames, generation I/O separation (Track M) | p99 tails at 20 presences | low | low |
| P9 | Measurement honesty upgrades (§11.3/§11.5 gaps) | evidence stops being disqualified/blind | low | low |
| P10 | Kitty-graphics niche probe (Track G) | narrow (modal portraits) | high | high — likely reject |

Immediately-actionable defects found during audit are folded into their parent proposals and marked **[defect]**.

---

## 2. Proposals

### P1 — Applied-base convergence transport ("Mosh SSP over the PTY")

**Mechanism.** Promote the existing CPR barrier from telemetry to the transport's source of truth. Maintain three codec states per session: `appliedBase` (last grid whose barrier was acked — a retained copy of the packed planes, ~150–200 KB/session), `inFlight` (≤1 encoded transform + its barrier id), `desired` (newest authoritative grid, replaceable). Encode every transform **from `appliedBase`**, not from "whatever was last encoded". On ack: `appliedBase ← inFlight.target`, immediately encode `appliedBase → desired` if newer state exists (exactly skipping obsolete intermediates, per Mosh). On drop/timeout: nothing is lost — re-encode `appliedBase → desired`; **recovery keyframes become unnecessary in the ordinary path** (a keyframe is only for genuine unknown-state events: resize, alt-screen flips, palette-loss suspicion). Barrier identity: encode a rolling id in the parked cursor column — `ESC 7 CSI 1;{1+k} H CSI 6 n ESC 8`, k = frame id mod 32 → reply `ESC[1;{1+k}R` names the frame it fences (challenge §9.A anticipated exactly this). Pace sends at `clamp(SRTT/2, 20 ms, 250 ms)` with an 8 ms collection delay (Mosh constants), where SRTT comes from barrier acks corrected by the keepalive probe (P9).

**Why stock-SSH compatible.** Pure ECMA-48 (DECSC/CUP/DSR/DECRC) through the PTY; capability-probed; exact fallback = today's drop-then-keyframe path.

**Layer/files.** `terminal-applied-barrier.ts` (id encoding, adaptive timeout, streaming matcher), `terminal-codec.ts` (encode-from-arbitrary-base: keep `appliedView` planes beside `packedTerminalView`; ~copyWithin on ack), `session-proxy.ts` (state machine replaces `awaitingKeyframe` drop logic), `worker-session.ts` (desired-state replacement).

**Hypothesis & effect size.** (a) Steady p95 visible-input-response overhead beyond RTT at 64 kbit/s drops from ~25–35 ms to ≤ one collection interval, because stale bytes are never admitted and nothing waits behind recovery images; (b) `recoveryRequests` → 0 under forced window stalls (vs 47 in the §5 incident); (c) thin-link frame gaps p99 shrink ≥ 3× because a delta re-based on `appliedBase` after a stall is far smaller than a 270 KB keyframe.

**Correctness/security risks.** (1) CPR reply interleaving with typed input — Ghostty emits the reply as one atomic small write, but the SSH client releases tty bytes on the 20 ms obfuscation clock, so replies may share a CHANNEL_DATA with keystrokes and **may split across reads**. **[defect]** `consumeInput` (`terminal-applied-barrier.ts:88-99`) uses per-chunk `Buffer.indexOf` — a split `ESC[1;1R` today leaks into game input *and* falsely flips the probe to `unsupported`. Needs a stateful streaming matcher regardless of P1. (2) DECOM must be pinned off (CPR is origin-relative under DECOM). (3) Resize invalidates in-flight barriers (mode 2048/`CSI 18 t` reports make this in-band, P9). (4) A user can type `ESC[1;5R` bytes manually — treat any matching reply while ≥1 barrier is in flight as an ack only for the *oldest expected id*; ids are single-use; a forged ack merely accelerates a diff whose base the terminal has already parsed past in the ordered stream — still exact, but verify with the emulator oracle. (5) Memory: +1 packed grid copy/session (~200 KB at 210×60) — trivial vs 652 MiB worker RSS.

**Instrumentation to falsify.** Per-barrier RTT distribution vs `tcpi_rtt` vs keepalive RTT (decomposition, P9); acked-base age; count of exact-skip events; bytes saved vs keyframe recovery.

**Experiment.** Impairment ladder A/B at 240 ms × {4 Mbit, 256 kbit, 64 kbit} with forced window stalls (§11.4): current build vs P1 build; then physical Ghostty from Australia. Emulator oracle replays every emitted stream from login and asserts grid equality with `desired` at each barrier, including injected truncation at every sequence boundary.

**Oracle.** Extend `packages/render/src/__tests__/terminal-emulator.ts` to model margins+DECOM+palette; assert `emulator(applied stream) == appliedBase` at every ack, and final-state equality after interruption/resume.

**Acceptance.** §11.3 full RTT×bandwidth matrix, geometries ×3, scenarios: held movement, stalls, resize-during-flight, 20-presence; ≥1,000 barrier samples per cell.

**Rollback.** Feature flag; `unsupported` state (probe timeout) reverts to today's path automatically.

**Evidence to publish.** Barrier RTT histograms, recovery counts, exact-skip counts, emulator-oracle pass logs, before/after ladder tables.

**Unknowns.** Whether Ghostty's CPR cost is measurable at 15 Hz probe rate (expected trivial: reply generated inline during parse); non-Ghostty conservative terminal behavior (probe decides); interaction with future alternate-screen modals (barrier suspended on alt-screen).

---

### P2 — Admission-before-render + AoI pacing

**Mechanism.** Move the admission decision **upstream of world sampling and encoding**. Scheduler asks (per session, per tick): `pump.canAdmitFrameNow() && barrierNotSaturated && withinPacing` *before* `renderToString`. If not admittable: skip sampling entirely (simulation ticks continue; presentation samples don't), coalescing ambient time into the next admitted frame. Replace the async presentation-pause round-trip (**[defect]** worker keeps rendering for one IPC RTT after stall, output then discarded at `session-proxy.ts:171`) with the same gate evaluated worker-side from mirrored credit state. Add: **event-driven credit** — hook `CHANNEL_WINDOW_ADJUST` (an `Object.defineProperty` setter on `channel.outgoing.window`, or a 5-line ssh2 patch emitting `'windowAdjust'`) to replace the blind 8 ms poll (**[defect]** `output-pump.ts:221-233`); **size-aware admission** — admit only if `outstanding + frameBytes ≤ cap` (**[defect]** today a frame is admitted whole with 1 byte of credit left → real bound = cap + full frame); **fragmented writes** at 32 KiB packet granularity re-checking credit and input-lane priority between fragments (enables a tiny interaction patch to overtake a half-written ambient frame at packet, not frame, granularity — the only overtaking TCP permits); **credit accounting for `writeImmediate`** (**[defect]** `output-pump.ts:143-163` bypasses the credit gate entirely, and when backpressured its packet enters the ordinary queue where the next enqueue's drop loop can drop it and trigger a *spurious recovery keyframe*). Pace ordinary frames at the AoI operating point: target utilization ≈ 0.5 of measured drain rate (window-adjust cadence gives drain ≈ tty-fd throughput for free), never above.

**Stock-SSH compatible:** server-only. **Files:** `cooperative-render-scheduler.ts`, `worker-session.ts:739-762`, `output-pump.ts`, `session-proxy.ts`, optional 5-line ssh2 patch (vendored via pnpm patch).

**Hypothesis & effect.** `input_to_immediate_output_ms` p95 ≤ 5 ms on a normal host (challenge target) because input work never queues behind ambient encoding; wasted render+IPC per stall → 0; credit-resume latency −(0–8 ms) per pause; outstanding bytes bounded by `cap + one 32 KiB packet` exactly (challenge Track I target line).

**Risks.** Starvation of ambient state under sustained low credit — keep the existing starvation bounds (weather/NPC/clock coalesce but never stop); `defineProperty` on ssh2 internals is version-pinned — guard with a feature test at boot, fall back to the poll.

**Falsify via** the existing pump/worker telemetry + new `notsent` gauge (P7): if p95 unchanged on the 240 ms/64 kbit rung, the bottleneck was elsewhere (measure, don't assume).

**Experiment/oracle/acceptance.** Same ladder rungs as P1; emulator oracle unchanged (admission changes *when*, never *what*). **Rollback:** flags per sub-feature. **Unknowns:** whether Node timer slack dominates below 5 ms; exact drain-rate estimator smoothing.

---

### P3 — Cold-login program: overlap, pre-encode, progressive exact paint

**Mechanism.** Attack the measured cold path in its actual order (`worker-session.ts:408-745`):
1. **Overlap, don't sequence** — the scripted entrance screen burns **~2.5 s of pure `await sleep`** (`worker-session.ts:1801-1871`: 400+300+500+800+100+400 ms) *before* the first world keyframe; boot/entrance bytes + `fillScreenBackground` (full-width padded lines, `pixel-game-renderer.ts:414-427`) + `CSI 2J` repaint the screen ~3× before the world appears. Run world prep (steps 3–7) concurrently with the entrance animation and let the entrance *end* into an already-encoded first frame; drop one of the redundant full-screen fills. Zero fidelity change: same visuals, same order, no sleeps on the critical path.
2. **Pre-encoded origin keyframes** (challenge Track K, unimplemented today — prewarm covers world data, not terminal bytes): cache the exact ANSI keyframe **bytes** keyed by `(cols, rows, capabilityProfile, paletteEpoch)` for the top geometries (160×46, 210×60, most-seen smaller). The origin view at (0,0) is deterministic except ambient phase/clock/weather → encode the static origin once, then send it + one ordinary small delta (clock/weather/actors) on login. First world write becomes a memcpy, not a render+encode.
3. **Progressive exact presentation for thin links**: when measured drain rate says the full keyframe needs > ~1.5 s, stream the origin in **salience order — spawn-centered block outward** — as N independent chunks, each wrapped in its own `?2026` bracket (**each bracket must close well inside Ghostty's hard 1000 ms sync auto-reset** — chunk size ≤ drain_rate × 0.5 s), each chunk exact for its region, HUD + `Pos: (0,0)` + input-ready first. No lossy intermediate: every presented partial state is an exact rendering of a subset of regions (Track K's wording already permits this). There is *no direct prior art* for salience-ordered exact terminal fill (verified negative) — this is a novelty claim worth publishing.
4. **Handshake floor**: accept `none`-auth (ssh2 supports it server-side; Maldoror mints a fresh session per login anyway) → saves the none-probe→pk-query→pk-sign round-trips (~2 RTTs ≈ 0.5 s at 240 ms); no banner; single ed25519 hostkey. Product decision required — record it in the challenge doc if adopted.
5. **First-burst delivery**: the cold keyframe (~40–57 KB wire at factor 0.15–0.21) from `cwnd 10` costs 2–3 extra RTTs (verified live: cwnd collapses post-idle, `tcp_slow_start_after_idle=1`) — see P7 for per-route `initcwnd` and pacing fixes.

**Hypothesis & effect.** 4 Mbit cold: first correct interactive world view ≤ 1 RTT + 250 ms after auth (challenge target) — the 243.9 ms cold first-visible already observed at 4 Mbit suggests the transport can; the 2.5 s entrance is the actual perceived-cold dominator at high bandwidth. 64 kbit cold: handshake (~1.8 s, protocol floor) + HUD+center region (~3–5 KB wire ≈ 0.5–0.8 s) ≈ **~2.5–3 s to exact interactive partial view**, full origin converged ≤ 8 s in background — vs 8.7 s to *anything*. The barrier build's 334 ms artifact tonight needs stage decomposition (P9) before claiming mechanism.

**Files.** `worker-session.ts` (start sequencing), `pixel-game-renderer.ts` (initialize/fill), new `origin-keyframe-cache.ts` in `packages/render`, `ssh-server.ts` (auth), ladder (stage timestamps).

**Risks.** Pre-encoded bytes must be regenerated on world-origin change / palette epoch / capability profile — key the cache and hash-verify against a fresh encode in CI (exactness oracle); progressive chunking must handle input arriving mid-fill (input lane already separate); `none`-auth is a security-posture change — document, keep host-key semantics identical.

**Falsify.** Per-stage cold timestamps (P9): if entrance overlap + pre-encode don't move total, the remaining cost is handshake/cwnd — pivot to P7.

**Rollback.** Flags; cache bypass. **Unknowns:** how much of the 334 ms artifact is measurement semantics vs real; smallest exact "interactive shell" users accept (product).

---

### P4 — Palette-register exact color compression + palette lighting

**Mechanism.** Ghostty stores palette *indices* in cell state and resolves RGB at render time (verified — §0.2). Exploit in two exact ways:
1. **Frame color-census compression**: per frame (or per stable region), count distinct RGB values. The world's painterly output is palette-driven; if active colors ≤ free registers (~200 slots: 16–191 + 224–255; 192–223 reserved for material cycling), define them via one OSC 4 packet and emit `38;5;n`/`48;5;n` (~9–16 B/pair) instead of truecolor (~20–38 B/pair) — raw halving of SGR bytes, **exact by construction** (registers hold the exact RGB; no quantization — colors beyond capacity stay truecolor). Keep register assignments **stable across frames** (LRU) so deltas rarely re-define.
2. **Palette lighting**: day/night/weather tint = rewrite the register set (~a few hundred bytes) instead of repainting every cell — the mechanism the water animation already proves at 8-slot scale. This makes *global lighting changes nearly free on the wire*, one of the most expensive ambient events today.

**Compatibility.** OSC 4 + indexed SGR everywhere; fallback = current truecolor (probe: OSC 4 `?` with DA1 fence; `osc-color-report-format=none` handled by fence timeout → truecolor).

**Files.** `terminal-codec.ts` (census + register allocator; indexed emission paths already exist end-to-end), `palette-cycle.ts` (band coordination), `pixel-game-renderer.ts` (lighting → palette epoch), P1 state model (palette registers are terminal state → include in `appliedBase` and in keyframes; recovery resends the register file — the plumbing OSC 104/restore already exists).

**Hypothesis.** Raw SGR bytes −40–60 % on keyframes and weather/lighting frames; **wire** bytes unknown until measured — truecolor SGRs are highly repetitive and zlib already eats them (factor 0.15 observed), so the compressed win may be far smaller than the raw win. This is exactly why P6 must land first. Effect worth keeping if wire −≥15 % or lighting-tick wire −≥80 %.

**Risks.** Register lifetime vs in-flight frames (an OSC 4 redefine recolors *already-painted* cells — a feature for lighting, a hazard for census churn: never reuse a register while any in-flight frame's cells still reference it — P1's ack model provides the safe reclamation point); recovery must treat palette as part of screen state (add to emulator oracle + hash model).

**Falsify.** P6 per-frame wire counters, A/B same world trace. **Rollback:** flag → truecolor. **Unknowns:** real per-frame color counts at 210×60 (instrument first — likely 100s–1000s at octant resolution; region-scoped census may be needed).

---

### P5 — Codec upgrades from battle-tested prior art

**Mechanism** (each independent, all exact):
1. **Stop re-diffing the world** **[defect-adjacent]**: the renderer already returns `sharedStaticDirtyCellOffsets` (`pixel-game-renderer.ts:1521-1525`) and the codec ignores it, re-scanning the full grid (`terminal-codec.ts:392-400`). Feed dirty offsets + per-row FNV hashes into `emitPackedChangedRuns` to skip clean rows — O(changed) instead of O(cells) per frame.
2. **Row-hash scroll discovery** (ncurses `hashmap.c`, "modified Heckel's algorithm"): rolling hash per row, unique-pair anchors, grow hunks, `cost_effective()` gate — catches scroll opportunities the camera-vector path rejects (sub-viewport pans, cutscenes, chat scroll) and generalizes motion compensation beyond "whole-cell camera moves".
3. **ECH for blank runs** (Mosh threshold: `clear_count > 4` when erased style is exact) and tmux's EL/EL1/ED hierarchy for clears — cheaper than repaint runs; Ghostty implements ECH incl. wide-char split protection.
4. **Cursor-motion cost model** (ncurses `lib_mvcur.c` tactics, costs in bytes not ms): today only CUP-vs-CUF is considered; add CR, BS runs, VPA/HPA to the same exact byte-compare framework the gap-merge already uses.
5. **Tile hashes + per-session dirty masks** (Track L, Tribes Most-Recent-State): partition the grid into tiles (e.g. 16×4); per session track `authoritative/encoded/admitted/applied` tile hashes (hash = codepoints+fg+bg+indices+palette-epoch+modes). On drop or timeout, mark that packet's tiles "lost unless a later packet covered them" (Tribes' exact rule) → resend only still-uncertain tiles from `appliedBase`. This is P1's recovery made sub-frame-granular and is the data structure Track L asks for.
6. **Negative results (preserve per §15.3):** SL/SR, DECCRA/DECFRA/DECERA, DECRQCRA, DECXCPR — all absent from Ghostty (§0.2): do not build primary paths on them; tmux does **not** use REP (verified myth); Eternal Terminal is byte-resumption, not state sync — nothing to borrow; injecting loss in the userland loopback proxy is dishonest (TCP under it never sees the loss) — see P9.

**Files.** `terminal-codec.ts`, `pixel-game-renderer.ts` (plumb dirty offsets), new `tile-state.ts`. **Hypothesis:** codec CPU p95 −50 %+ at 20 presences (diff scan dominates today); ambient frame raw bytes −10–25 % (ECH/cursor tactics); recovery bytes after stalls −90 % (tile masks vs full keyframe). **Falsify:** per-frame `encode_ms` + raw/wire counters; emulator oracle on every change. **Risks:** low — all output remains ECMA-48 already emitted or probed; hash model must include *every* attribute (challenge Track L's warning) — the oracle enforces it. **Rollback:** per-technique flags.

---

### P6 — Wire-cost truth: instrument ssh2's deflate, then let bytes be judged where they're paid

**Mechanism.** The gap-merge and REP thresholds optimize **raw** bytes (`terminal-codec.ts:465`), but the challenge (§8.5) demands wire bytes. Cheapest exact source: ssh2 already deflates every packet synchronously in `ZlibPacketWriter` (`zlib.js:89`) — add a per-connection counter of (raw in, compressed out) exposed per channel (2-line vendored patch), giving **exact per-frame wire attribution** when combined with frame boundaries. Server-side mirror deflate (same `Z_PARTIAL_FLUSH` points) only for offline A/B research via `deflateCopy` candidate probes — not on the hot path. Then re-run the encoding-strategy questions as experiments: scan order (row-major already aligns with the 32 KiB LZ window — a 270 KB keyframe *cannot* LZ-match rows >32 KB back, so far-apart repetition arguments are void — FACT §0.3); REP threshold; gap-merge on wire cost; keyframe cadence effect on dictionary; small-write packetization effects.

**Files.** vendored ssh2 patch, `session-proxy.ts` (per-frame attribution), `tools/render-sim` (report both byte kinds — §11.5 requires it). **Hypothesis:** at least one current "optimization" is wire-negative (candidate: gap-merge repaints that break REP/Huffman runs). **Risk:** near-zero (counters). **Rollback:** drop patch. **Unknowns:** CPU cost of offline `deflateCopy` probing (bounded: research harness only).

---

### P7 — Kernel/socket program (measure → then change, per challenge §16.4)

**Mechanism.** (1) **Telemetry first**: a ~50-line N-API addon — `getsockopt(TCP_INFO)` (rtt/min_rtt/cwnd/`tcpi_notsent_bytes`/retrans/pacing_rate) sampled 1 Hz per session socket into the existing metrics; `ss -ti` harness poller as the zero-code cross-check (already proven live on the box). This closes the "how many bytes below Node" blindness with numbers instead of inference, and quantifies the §0.3 post-idle cwnd collapse in real sessions. (2) **`TCP_NOTSENT_LOWAT = 16 KiB`** per-socket (Cloudflare-validated value): caps stale bytes in the kernel's *unsent* queue so the byte-age bound (Track I) finally spans codec→kernel. (3) **Per-route `initcwnd/initrwnd`** for measured player routes (box iproute2 supports it; scoped, reversible — no host-wide change) to de-tax post-idle keyframes and cold login; evaluate `congctl bbr` per-route the same way. (4) Socket-level counters also expose ssh2's two unbounded lanes (**[defect]** rekey queue; ignored `socket.write()` return) — add gauges + a rekey-aware admission pause.

**Compatibility:** server-side socket options; SSH semantics untouched. **Hypothesis:** post-idle keyframe delivery −1–2 RTTs (initcwnd); stale-byte age bounded ≤ cap+LOWAT+1 packet; BBR effect on this app-limited flow likely small — measure, don't assume (verifier's correction: cwnd grows fine under sustained load). **Risks:** addon must fail-open (no fd, no option → no-op); document per-route changes in `donto-infra`; guardrails per challenge Track J (isolated port first, before/after traces, rollback = route delete). **Falsify:** ladder + physical-Australia `ss -ti` traces before/after.

---

### P8 — IPC + process isolation

**Mechanism.** (1) `fork(..., { serialization: 'advanced' })` (**[defect]** default JSON: every ESC in a frame string crosses IPC as 6-byte ``, every input Buffer as a JSON number array — `worker-manager.ts:789`, `wm:724`); send frames as `Buffer` (structured clone moves near-raw) and input as Buffer. (2) Reuse frame build buffers; drop the speculative gap-merge double-encode garbage via a byte-length estimator (exactness kept: estimator gates, byte-compare decides). (3) Generation/interactive separation (Track M): Sharp/PNG decode currently shares the worker loop; move behind the admission queue into a subprocess in `maldoror.slice` with io-weight below the interactive worker; PSI-reactive rejection of background work (the box's `/dev/sdb` pressure DQ'd 7/9 acceptance runs — also an ops issue, P9). **Hypothesis:** IPC `callback_ms` p99 (1,391 ms in the incident) −10× under load; worker GC pauses shrink measurably at 20 presences. **Falsify:** existing `IpcSendTelemetry` before/after; `majflt/ctxt` fields (P9). **Risk:** advanced serialization changes message framing — one flag, integration-tested; structured clone of huge strings still copies (Buffers avoid re-encode). **Rollback:** flag.

---

### P9 — Measurement honesty upgrades

**Mechanism** (each maps to a §11.3/§11.5 gap found tonight):
1. **Cold-stage decomposition**: timestamps for first-byte, first `?2026h`, keyframe-complete, first `Pos:`, first movement in the ladder (`ssh-load-ladder.py:183-262`) + server-side stage marks through `worker-session.start` — required before believing the 334 ms artifact.
2. **Real CPR timing**: per-query→reply latency distributions (harness currently only counts); physical-Ghostty pass records the same.
3. **Latency decomposition triple**: `tcpi_rtt` (network) vs SSH-level probe (server→client global request; OpenSSH replies to unknown global requests with MSG_FAILURE at the ssh layer, no terminal involvement — a free liveness/RTT probe; verify reply behavior against ssh2 send path first) vs CPR ack (network + client + parse). Differences isolate terminal-parse/apply cost per live session — nothing else in the doc measures that today. (HYPOTHESIS until the global-request reply is confirmed from stock clients.)
4. **Impairment fidelity**: jitter/stall injection in the proxy is honest; **loss is not** (userland proxy over loopback TCP — the real TCP never retransmits) → loss/reorder runs move to netns+netem; validate the proxy against pcap timestamps (§11.3 requirement).
5. **Wire truth**: per-run loopback pcap + P6 counters; report raw + compressed + wire in every table (§11.5).
6. **Host qualification economics**: 7/9 runs tonight were DQ'd on ioFull PSI (donto extraction on `/dev/sdb`) — add wait-for-qualified-window looping around preflight, and cgroup/io-isolate the acceptance stack so evidence stops being wasted; report Maldoror-cgroup swap separately from host swap (challenge §2.12).
7. **Noise floors documented**: ObscureKeystrokeTiming quantizes *all* client→server bytes at ~20 ms (§0.3) — every physical input-latency table must carry it; `majflt/ctxt/cgroup` fields added to `process_tree_snapshot` (trivial — same `/proc` files).

**Files.** `tools/render-sim/*`, `output-pump.ts` gauges, ops notes. **Risk:** none. **This proposal gates all others' evidence.**

---

### P10 — Kitty graphics niche probe (expected reject, run to close Track G honestly)

Ghostty implements transmit/placement/delete + Unicode placeholders (no animation actions), 320 MB budget, `CSI 16 t` gives exact cell-pixel geometry. A full-world bitmap path would (a) re-render the intended *cell art* as pixels — changing the art, (b) break copy/paste/accessibility semantics, (c) cost multi-second cold uploads at 64 kbit/s — i.e., fail challenge §9.G's own rejection clause. The one defensible niche: lossless PNG portraits in modals (avatar/building close-ups) where a PNG beats octant cells in bytes *and* fidelity is literally the source asset. Proposal: one-day probe measuring modal-portrait bytes vs octant rendering at 64 kbit/s, behind XTVERSION gating with exact cell fallback; reject with numbers if it doesn't dominate. **Rank last; do not let it displace P1–P9.**

---

## 3. What I would build first (dependency-ordered)

1. **P9.1–.2 + P6 counters** (days): stage decomposition + real CPR timing + wire attribution — every later claim needs them.
2. **P2** (days): admission-before-render + event-driven credit + size-aware fragmented admission + `writeImmediate` accounting. Small, safe, immediately measurable.
3. **P1** (1–2 weeks incl. oracle work): the structural win. P5.5 tile masks slot in as its recovery layer.
4. **P3** (parallel with P1): entrance overlap + pre-encoded origin first (pure win), then progressive exact paint on the P1 machinery.
5. **P7 telemetry → P7 socket options** (measure first), **P8** one-liners early (advanced serialization is nearly free).
6. **P4/P5 codec economics** once P6 can price them in wire bytes.
7. **P10** last, expecting a documented rejection.

## 4. Standing corrections to the challenge doc

- §9 Track A: DECRQCRA does not exist in Ghostty — strike the "stronger acknowledgement" branch for the primary terminal; CPR-with-coordinate-ids is the whole design space (and it suffices).
- §9 Track D: DECCRA/DECFRA/DECERA and SL/SR are absent in Ghostty; margin+SU/SD+ICH/DCH+ECH+REP is the complete usable set on the primary terminal.
- §9 Track E: both open questions are now answered from source — palette mutation *does* recolor painted cells (usable as the lighting primitive; makes register lifetime a real dependency), and palette state *is* queryable (fenced).
- §9 Track F: synchronized output carries a hard 1000 ms auto-reset in Ghostty — progressive/cold paths must chunk brackets accordingly.
- §8.3: window adjust semantics are better than the doc assumes: it proves *tty-fd write* progress (not just SSH consumption), at ~96 KiB granularity — a free coarse drain signal.
- §11.5 should add: the ≥ 9.5 OpenSSH client quantizes all upstream bytes at ~20 ms (ObscureKeystrokeTiming default) — a client-side noise floor on every input-latency figure that no server change can remove, and it also rides on CPR ack timing.

---

*Sources: all file:line references are to the repo at `f38239c` + the deployed dirty tree, `ssh2@1.17.0` as vendored, Ghostty `46edeee407`, OpenSSH-portable master (2026-08-02), tmux/notcurses/ncurses/mosh masters (2026-08-02), RFC 4253/4254, Mosh paper (USENIX ATC'12), Tribes networking paper (1998), Kaul/Yates/Gruteser (INFOCOM'12), Costa/Codreanu/Ephremides (TIT'16), Sun et al. "Update or Wait" (TIT'17). Compiled with a 9-agent research workflow (3 code auditors, 3 domain researchers, 3 adversarial verifiers) plus direct audit.*
