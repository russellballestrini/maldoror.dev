# Regional paired focal alternatives V2 source

Two 1536x1024, 3x2 source boards were generated on 2026-07-29 with the built-in
Codex/ChatGPT image-generation subscription. No metered project API was used.

- board A: `regional-paired-focal-alternatives-a-v2-source.png`, SHA-256
  `ac625372d18c5abfc420070167dec643c4aa92021d98fa68eb4ab4a7e48e1c47`;
- board B: `regional-paired-focal-alternatives-b-v2-source.png`, SHA-256
  `b881b951e56785a9a8e0d7d48798d1b868c97c0d140c49ca8e4e3685e7f2f48b`.

Each cell is a second deliberately distinct family workplace/civic silhouette.
Board A contains a canal ropewalk, forest coppice sawpit, coast sailmaker and
net loft, rural cider press, mountain ore stamp mill, and ruins ossuary
gatehouse. Board B contains a canal chandlery/watch house, forest apiary/honey
house, coast tide observatory, rural threshing barn, mountain cable-hoist
station, and a collapsed ruins amphitheatre shrine, in
canal-town/forest/coast/rural/mountain/ruins order.

Run
`MALDOROR_PAIRED_FOCAL_VERSION=v2 pnpm assets:derive-paired-focal-alternatives`
for fixed-cell extraction, border-derived chroma matting, transparent trim,
terminal-shadow grading, fail-closed alpha validation, and byte-stable PNG
encoding with volatile metadata stripped. Derivation also pins the matte helper
content to SHA-256
`3f7b9b14ad5c90f37618bc1c16a039a2076abca12ddc41b3ae470e2b1cad6c0e`
so helper drift fails rather than silently changing the asset corpus. The
hash-pinned source copies, ordered prompt-subject ledger, reduced-scale boards,
experiments, and acceptance evidence live in the mounted V191 research record.
