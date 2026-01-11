# Settings and QC (Plain English)

This page explains what the Settings do and how to read the QC values.

## Settings

- Reference DB
  Pick the reference database used for scoring (different taxa groups).

- Plot display
  - Raw: shows the unprocessed spectrum in the selected m/z window.
  - Processed: shows the spectrum after preprocessing (baseline subtraction and/or normalization).
  - Normalize display to max: scales the plotted intensities so the maximum becomes 1.0.

- m/z window
  Sets the range of m/z values used for analysis. Anything outside is ignored.

- Preprocess
  - Enable preprocess: turns on preprocessing before peak picking and scoring.
  - Normalize (processed) to max: scales processed intensities so the maximum is 1.0.
  - Baseline subtract (SNIP): removes a slowly varying baseline using the SNIP algorithm.
  - SNIP iterations: higher values remove broader background; too high can flatten real peaks.

- Peak picking
  - Enable peak picking: finds local maxima to use for scoring.
  - Min rel. intensity: minimum intensity (as a fraction of the max) to keep a peak.
  - Min peak distance (Da): minimum separation between peaks; closer peaks get merged.

- Monoisotopic filtering
  Removes isotopic peaks to keep only monoisotopic peaks.
  - Tolerance (Da): allowed deviation when matching isotope spacing.
  - Isotope spacing (Da): expected isotope spacing.
  - Max isotopes: how many isotope peaks to remove per monoisotopic peak.

- Scoring grid
  Defines the binning grid for correlation scoring (start, end, step).

- Contaminants
  Tolerance (Da) for matching contaminant peaks.

- FDR (target-decoy)
  - Enable decoy confidence: turns on per-sample confidence using decoy scoring.
  - Decoys (n): number of decoy taxa to generate.
  - Max decoys: upper limit for performance.
  - Seed: deterministic seed so decoys are reproducible.
  - Tolerance (Da): minimum separation used to avoid decoys too close to real markers.

## QC Summary (export)

These fields are included in the "QC Summary" sheet of the Excel export.

- peakCount
  Number of peaks used for scoring after processing.

- maxIntensity
  Maximum intensity in the cropped raw spectrum.

- markersTotalTop / markersMatchedTop / fracMarkersMatchedTop
  How many markers are available for the top-ranked taxon and how many were matched.

- medianAbsDeltaDaTop / medianAbsPpmTop / iqrAbsPpmTop
  Median and spread of marker mass errors for the top taxon. Large values may indicate poor matching.

- contaminantsMatched / maxContaminantIntensity
  Number of contaminant matches and the highest contaminant intensity.

- FDR fields (nDecoys, bestDecoyScore, decoyGap, qSample)
  - nDecoys: how many decoys were scored.
  - bestDecoyScore: highest decoy score for the sample.
  - decoyGap: top real score minus best decoy score (larger is better).
  - qSample: fraction of decoys scoring at least as high as the top real score (lower is better).

## Confidence labels

The UI shows a confidence label for each sample:

- High: qSample <= 0.01
- Medium: qSample <= 0.05
- Low: qSample > 0.05

Use decoyGap as extra context: zero or negative gaps suggest weak separation.

## Confidence estimation (summary)

Confidence levels reflect separation from random matches and from competing taxa, not a single statistical probability.

Procedure summary:
- FDR control (q-value): reject if qSample > 0.05
- Separation from decoys: use best_score / best_decoy_score (or best_score - best_decoy_score when decoy scores are very small)
- Taxonomic discrimination: down-weight when top and second-best taxa are very close
- Evidence sufficiency (optional): down-weight if very few markers support the call

Confidence	Interpretation
High	Strongly above decoys and clearly separated from alternative taxa
Medium	Above decoys but limited separation or moderate ambiguity
Low	Statistically admissible but weak separation or sparse evidence
Rejected	Not convincingly above random matches

Confidence labels are intended as interpretive guidance, not exact probabilities.
