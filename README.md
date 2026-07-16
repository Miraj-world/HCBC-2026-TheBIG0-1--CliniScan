# CliniScan

CliniScan is a layered multimodal triage support app for hackathon/demo use. It combines typed or voice-captured symptom text, structured intake fields, optional image analysis, and similar-case retrieval to generate urgency guidance and a structured report.

## Live Website

**Use CliniScan:** [https://cliniscan-hcbc.netlify.app/](https://cliniscan-hcbc.netlify.app/)

The public product is the polished React website hosted on Netlify. It connects to the
FastAPI analysis service hosted on Render at
[https://cliniscan-api.onrender.com](https://cliniscan-api.onrender.com/health).

## Safety

CliniScan is **not** a diagnosis tool and not a replacement for licensed care.

> Not a medical diagnosis. Always consult a licensed medical professional.

## Current Features

- Structured intake: symptom text, body location, duration, pain severity (1-10), age, known conditions, medications.
- Voice-enabled symptom entry: users can type symptoms manually or record audio in the browser. The backend transcribes audio with OpenAI Whisper and optionally formats the transcript into concise clinical language with Claude before filling the symptom field.
- Optional image input for visual evidence extraction:
  - upload an existing `jpg/png/webp` image
  - open the device camera and capture a new photo
  - reject unsupported, oversized, or medically irrelevant images with a safe fallback
- Layered backend pipeline:
  - safety override
  - symptom structuring
  - vision extraction
  - deterministic evidence fusion
  - pgvector RAG retrieval (similar-case grounding)
  - quality gate
  - clinical reasoning
- Results dashboard with:
  - urgency badge
  - possible conditions + confidence
  - clinical assessment
  - risk signals and red flags
  - submitted-input toggle (shows uploaded image + entered fields)
- Report actions (top-right in Reports view):
  - Download PDF
  - Share (native share sheet, clipboard fallback)

## Tech Stack

- Frontend: React + Vite
- Backend: FastAPI
- AI providers: OpenAI + Anthropic
- Audio transcription: OpenAI Whisper (`whisper-1`)
- Clinical note formatting: Claude Sonnet, when `ANTHROPIC_API_KEY` is configured
- Similar-case retrieval: PostgreSQL + pgvector

## Repository Layout

```text
CliniScan/
  backend/
    main.py
    requirements.txt
    .env.example
    cache/
    db/
    layers/
    models/
  demo/
    demo.mp4
  android/
    settings.gradle
    app/
  ios/
    project.yml
    CliniScan/
    CliniScanTests/
    CliniScanUITests/
  frontend/
    package.json
    src/
  docs/android/
  docs/ios/
  tests/
  README.md
  requirements.txt
```

The native Android app lives in `android/` and the native iOS scaffold lives in `ios/`. Both are intentionally separate from the React website in `frontend/`.

## Setup

### Public React website

The production website uses React + Vite and is deployed on Netlify. The frontend build
must receive the hosted API URL at build time:

```env
VITE_API_URL=https://cliniscan-api.onrender.com
```

Deployment details and verification steps are documented in
[`docs/web-deployment.md`](docs/web-deployment.md).

### Optional Streamlit prototype

The repository also includes `streamlit_app.py` as a simplified prototype. It is not the
primary public UI and does not reproduce the polished React design.

Run it locally:

```powershell
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python -m streamlit run streamlit_app.py
```

For Streamlit Community Cloud, create an app from this repository and set the main file
path to `streamlit_app.py`. To use a different backend, add this app secret:

```toml
CLINISCAN_API_URL = "https://your-api.example.com"
```

### 1) Backend

macOS/Linux:

```bash
cd backend
python3 -m venv ../.venv
../.venv/bin/python -m pip install -r requirements.txt
cp .env.example .env
```

Windows PowerShell:

```bash
cd backend
python -m venv ..\.venv
..\.venv\Scripts\python -m pip install -r requirements.txt
copy .env.example .env
```

Set API keys in `backend/.env`:

```env
OPENAI_API_KEY=your_openai_key
ANTHROPIC_API_KEY=your_anthropic_key
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/cliniscan
DATABASE_URL_RAW=postgresql://postgres:postgres@localhost:5432/cliniscan
```

### 1b) pgvector RAG database setup

```bash
# 1. Create the database
createdb cliniscan

# 2. Install pgvector extension (if not already)
psql cliniscan -c "CREATE EXTENSION IF NOT EXISTS vector;"

# 3. Run seed script
python db/seed.py

# 4. Start the server normally
uvicorn main:app --reload
```

Run backend:

macOS/Linux:

```bash
cd backend
../.venv/bin/python -m uvicorn main:app --reload --port 8000
```

Windows PowerShell:

```bash
cd backend
..\.venv\Scripts\python -m uvicorn main:app --reload --port 8000
```

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Default URLs:

- Backend: `http://localhost:8000`
- Frontend: `http://localhost:3000`

If needed, override frontend API URL:

macOS/Linux:

```bash
VITE_API_URL=http://localhost:8000 npm run dev
```

Windows PowerShell:

```bash
set VITE_API_URL=http://localhost:8000
npm run dev
```

## Voice Recording Notes

- The symptom field shows a microphone button only when the browser supports `MediaRecorder` and `getUserMedia`.
- Microphone access must be allowed by the browser and operating system. If the in-app browser blocks access, open `http://127.0.0.1:3000/` in Chrome or Safari and allow microphone permission.
- Voice capture is optional. The textarea remains editable before and after transcription, and failed voice capture does not block normal form submission.
- `/transcribe` requires `OPENAI_API_KEY`. If `ANTHROPIC_API_KEY` is missing, transcription still works and the raw transcript is returned as the clinical note fallback.

## Camera and Image Notes

- **Upload an image** accepts JPG, PNG, and WEBP files up to 10 MB.
- **Open camera** uses the browser `getUserMedia` API and prefers the rear-facing camera on supported mobile devices.
- Camera access requires HTTPS in production and explicit browser permission from the user.
- A captured photo is converted to JPEG and sent through the same `/analyze` image pipeline as an uploaded file.
- If an image is unavailable, unsupported, or not medically relevant, CliniScan continues in text-only mode and reports that limitation.

## Demo Video

The project demo video is stored at [`demo/demo.mp4`](demo/demo.mp4). The file is H.264/AAC MP4 and is kept under GitHub's 100 MB file limit.

## API

### `GET /health`
Returns backend/provider status.

### `POST /analyze`
JSON body:

- Required: `symptom_text`, `body_location`, `duration_days`, `severity_score`, `provider`
- Optional: `age`, `known_conditions`, `medications`, `image_base64`, `image_mime`, `demo_scenario`

### `POST /transcribe`
Multipart form upload:

- Required field: `audio`
- Supported browser recording formats: `webm` or `wav`

Returns:

```json
{
  "raw_transcript": "Patient's original spoken words...",
  "clinical_note": "Patient reports symptoms in concise clinical language..."
}
```

Failure behavior:

- `400` if `OPENAI_API_KEY` is not configured or the audio upload is empty.
- `422` if no speech is detected.
- `502` if Whisper transcription is unavailable.

## Verification

Run tests:

macOS/Linux:

```bash
.venv/bin/python -m pytest -q
```

Windows PowerShell:

```bash
python -m pytest -q
```

Build frontend:

```bash
cd frontend
npm run build
```

Current verified baseline:

- 23 backend tests passing
- frontend production build passing
- live Netlify website connected to the Render API
- live symptom-to-results workflow passing
- image payload, relevance gate, and text-only fallback passing
- desktop and mobile layouts passing browser QA
