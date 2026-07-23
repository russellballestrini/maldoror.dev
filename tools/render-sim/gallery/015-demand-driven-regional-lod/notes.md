# 015-demand-driven-regional-lod

2026-07-23T20:29:47.297Z

RESEARCH CANDIDATE — NOT LIVE. A CPU profile reproduced the minimum-zoom overview at 50.79s and attributed the blocking cost to eager texture/grid work: 10.49 million material pixels were composed before only 56,320 reached the faithful ANSI frame. The viewport can now request procedural terrain at its real screen footprint; semantic zoom bands prevent animation-cache churn, and linear-light material mip pyramids preserve low-zoom energy. The identical overview is 2.02s cold (25.1x faster), with boundary/interior ratio 0.999 and no return of the rejected root rings. Detail is 1.07s and the 16-cell tangent-aligned bridge is 1.22s. The side-by-side V5/V6 overview and faithful close frames are retained here. This closes eager-resolution waste only: predictive prewarming, live provider integration, silhouettes/architecture, p95/p99 traversal, Phase-0 approval, deployment, and physical Ghostty remain open.
