# ZooMZ Browser App for doing ZooMS collagen analysis (React + Plotly) 

[Zooarchaeology by mass spectrometry](ZooMS.md), commonly referred to by the abbreviation ZooMS, is a scientific method that identifies animal species by means of characteristic peptide sequences in the protein collagen.

This app supports:

- Upload `.mzML` / `.mzXML` files (batch)
- Interactive Plotly spectrum (zoom/pan)
- Peak picking
- Matching against **Speciescan-style reference DB CSVs** (one row per species/taxon; marker m/z in columns)
- Automatic contaminant search from `public/reference_dbs/contaminants_list.csv`
- Export marker matches for the currently-inspected taxon
- Note: expected input files are single-scan MALDI MS (multi-scan mzML is not supported)

## Run

```bash
npm install
npm run dev
```

## Reference DBs

Folder: `public/reference_dbs/`

- `manifest.json` lists selectable databases + contaminants file
- Populate the folder with Speciescan CSVs and update the manifest if you add/remove files.

[SpecieScan](https://github.com/mesve/SpecieScan)
Emese I Végh, Katerina Douka, SpecieScan: semi-automated taxonomic identification of bone collagen peptides from MALDI-ToF-MS, Bioinformatics, Volume 40, Issue 3, March 2024, btae054, 
[https://doi.org/10.1093/bioinformatics/btae054](https://doi.org/10.1093/bioinformatics/btae054)

