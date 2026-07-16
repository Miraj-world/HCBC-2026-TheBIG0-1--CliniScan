# CliniScan Documentation

This folder is for supporting project documentation. The main setup and run instructions live in the root `README.md`.

## Documentation Index

- [`web-deployment.md`](web-deployment.md): public React website, Netlify deployment, Render API connection, camera requirements, and production verification.
- [`android/`](android/): Android build and distribution notes.
- [`ios/`](ios/): iOS project, privacy, signing, testing, and backend deployment notes.

## Product Summary

CliniScan is a multimodal triage-support prototype. It accepts typed or voice-captured symptom text, structured context fields, and an optional image, then returns a structured risk assessment with possible conditions, confidence levels, risk signals, red flags, urgency, clinical assessment, and recommended next step.

CliniScan is not a diagnosis tool. It should always direct users to licensed medical professionals.

## Current Backend Modules

- `backend/models/schemas.py`: Pydantic request and response contracts.
- `backend/layers/safety_override.py`: Deterministic urgent keyword detection.
- `backend/layers/symptom_structurer.py`: LLM prompt layer for symptom text structuring.
- `backend/layers/vision_extractor.py`: LLM prompt layer for image feature extraction.
- `backend/layers/evidence_fusion.py`: Deterministic multimodal risk scoring.
- `backend/layers/quality_gate.py`: Input quality and uncertainty scoring.
- `backend/layers/clinical_reasoning.py`: JSON-only clinical reasoning prompt.
- `backend/layers/json_parser.py`: JSON parsing, schema normalization, and fallback output.
- `backend/layers/ai_gateway.py`: Anthropic and OpenAI request adapters.
- `backend/layers/rag_retriever.py`: pgvector similar-case retrieval.
- `backend/main.py`: FastAPI app, `/analyze` pipeline orchestration, and `/transcribe` voice transcription endpoint.

## Current Frontend

- React + Vite single-page app.
- Three main views: symptom intake, processing progress, and results dashboard.
- Symptom intake includes an optional browser-native microphone recorder. It sends recorded `webm` audio to `/transcribe`, fills the textarea with the formatted clinical note, and keeps the field editable.
- Image intake supports drag-and-drop upload, file browsing, and live device-camera capture. Captured photos and uploaded images use the same base64 `/analyze` request path.
- Live frontend analysis currently sends `provider: "openai"`.
- The current OpenAI model is `gpt-5.5`, configured in `backend/layers/ai_gateway.py`.
- The current UI does not expose provider selection or demo scenario buttons.
- The header uses a transparent CliniScan logo asset from `frontend/src/assets/CliniScanLogo.png`.
- Styled with `frontend/src/index.css`.
- Icons are provided by `lucide-react`.

## Validation

Public website: [https://cliniscan-hcbc.netlify.app/](https://cliniscan-hcbc.netlify.app/)

Production API health: [https://cliniscan-api.onrender.com/health](https://cliniscan-api.onrender.com/health)

From the repo root:

```bash
.venv/bin/python -m pytest
```

From `frontend/`:

```bash
npm run build
```

Current verified baseline: 23 backend tests passing, production frontend build passing,
live symptom analysis passing, and desktop/mobile browser QA passing.
