# Composants tiers du suivi de sujet

## NanoTrack v2

- `nanotrack_backbone.onnx`, `nanotrack_head.onnx`
- Source : https://github.com/HonglinChu/SiamTrackers, dossier `NanoTrack/models/nanotrackv2`
- Licence : Apache-2.0, voir `LICENSE-NanoTrack.txt`
- Modification : dans `nanotrack_backbone.onnx`, la hauteur et la largeur de l'entrée et de la sortie sont
  rendues dynamiques, car le même réseau reçoit des images de 127×127 et de 255×255. Les poids ne changent pas.
  `nanotrack_head.onnx` est identique à l'original (`nanotrack_head_sim.onnx`).

## EdgeTAM

- `edgetam_encoder.onnx`, `edgetam_attention.onnx`, `edgetam_decoder.onnx`, `edgetam_memory.onnx`
- Source : https://github.com/facebookresearch/EdgeTAM, `checkpoints/edgetam.pt`
- Licence : Apache-2.0, voir `LICENSE-EdgeTAM.txt`
- Modification : conversion en ONNX pour une entrée de 512×512 (`tool/edgetam_export/export.py`). Les poids ne
  changent pas ; l'équivalence avec le modèle d'origine se vérifie avec `tool/edgetam_export/verify.py`.

## ONNX Runtime Web 1.31.1

- `ort.wasm.min.js`, `ort-wasm-simd-threaded.mjs`, `ort-wasm-simd-threaded.wasm`
- Source : paquet npm `onnxruntime-web`
- Licence : MIT, Copyright (c) Microsoft Corporation
