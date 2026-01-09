# ZooMZ Browser App for doing ZooMS collagen analysis (React + Plotly)

![ZooMZ logo](ZooMZ_logo.png)

[Zooarchaeology by mass spectrometry](ZooMS.md), commonly referred to by the abbreviation ZooMS, is a scientific method that identifies animal species by means of characteristic peptide sequences in the protein collagen.

This app supports:

- Upload `.mzML` / `.mzXML` files (batch)
- Interactive Plotly spectrum (zoom/pan)
- Peak picking
- Matching against **Speciescan-style reference DB CSVs** (one row per species/taxon; marker m/z in columns)
- Automatic contaminant search from `public/reference_dbs/contaminants_list.csv`
- Per-sample confidence using target-decoy FDR scoring with configurable decoy settings
- Batch Excel export with QC summary, marker matches, and contaminants
- Confidence labels (High/Medium/Low) in results tables
- Note: expected input files are single-scan MALDI MS (multi-scan mzML is not supported)

FDR confidence thresholds used in the app:
- High confidence: qSample <= 0.01
- Medium confidence: qSample <= 0.05
- Low confidence: qSample > 0.05
- Decoy gap is the difference between the top real score and the best decoy score; larger gaps indicate stronger separation, while zero/negative gaps suggest weak confidence.

## Run

This app is hosted on Github Pages [https://arthuc01.github.io/ZooMZ/](https://arthuc01.github.io/ZooMZ/)

```bash
npm install
npm run dev
```

## Deploy (GitHub Pages)

This repo is configured to deploy on pushes to `main` via GitHub Actions.
If your repository name is not `ZooMZ`, update the `base` path in
`vite.config.ts` to `/<your-repo>/`.

## Reference DBs

Folder: `public/reference_dbs/`

- `manifest.json` lists selectable databases + contaminants file
- Populate the folder with Speciescan CSVs and update the manifest if you add/remove files.

[SpecieScan](https://github.com/mesve/SpecieScan)

Emese I Végh, Katerina Douka, SpecieScan: semi-automated taxonomic identification of bone collagen peptides from MALDI-ToF-MS, Bioinformatics, Volume 40, Issue 3, March 2024, btae054, 
[https://doi.org/10.1093/bioinformatics/btae054](https://doi.org/10.1093/bioinformatics/btae054)

Xenarthrans reference DB: https://pubs.acs.org/doi/10.1021/acs.jproteome.5c00636
Note: only MALDI-observable markers are included in the Xenarthrans list.

