## Summary

This change filters a noisy `materialxview` warning that includes machine-specific absolute paths to the default irradiance HDR (`irradiance/san_giuseppe_bridge_2k.hdr`).  
The warning is expected in some environments and is not actionable for fidelity comparisons, so excluding it keeps render reports focused on meaningful issues.

## What changed

- Added a dedicated log filter pattern for:
  - `Image file not found: .../irradiance/san_giuseppe_bridge_2k.hdr`
- Kept existing noisy-log filtering behavior in place.
- Updated tests to cover and verify filtering of this new warning message.

## Why

Absolute-path HDR warnings add noise and vary by local filesystem layout, which makes reports harder to scan and compare across machines/CI runs.

## Test plan

- Run: `pnpm test`
- Verify `packages/core/src/references.test.ts` passes with the new warning-filter case.
