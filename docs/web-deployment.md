# CliniScan Web Deployment

## Production URLs

- React website: [https://cliniscan-hcbc.netlify.app/](https://cliniscan-hcbc.netlify.app/)
- FastAPI health check: [https://cliniscan-api.onrender.com/health](https://cliniscan-api.onrender.com/health)
- Netlify project: `cliniscan-hcbc`
- Render service: `cliniscan-api`

## Architecture

The public CliniScan product uses the React + Vite app in `frontend/`. Netlify serves the
compiled static assets, and the browser calls the separately hosted FastAPI service on
Render.

```text
Browser -> Netlify React website -> Render FastAPI service -> AI providers / database
```

Streamlit is retained only as a simplified prototype. It is not the primary production
interface.

## Frontend Configuration

Vite reads the API base URL during the production build:

```env
VITE_API_URL=https://cliniscan-api.onrender.com
```

Without this value, the frontend falls back to `http://localhost:8000`, which is suitable
only for local development.

Build locally:

```powershell
cd frontend
$env:VITE_API_URL = "https://cliniscan-api.onrender.com"
npm install
npm run build
```

Deploy the linked Netlify project:

```powershell
npx --yes netlify-cli deploy --prod --dir=dist
```

The Netlify project is linked locally through `frontend/.netlify/state.json`, which is
ignored by Git.

## Backend Configuration

Render builds the backend from `backend/Dockerfile` using `render.yaml`. Production needs:

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DATABASE_URL`
- `DATABASE_URL_RAW`
- `ALLOWED_ORIGINS=https://cliniscan-hcbc.netlify.app`
- `ANALYTICS_ADMIN_TOKEN` with a long random value used only to read aggregate reports
- `ANALYTICS_HASH_SALT` with a separate long random value used to hash temporary session IDs

Render's free tier may sleep while idle. The React UI displays a wake-up state and allows
up to 90 seconds for the first analysis request to reach the service.

## Camera and Image Processing

The React intake screen provides two image sources:

1. **Upload an image** for JPG, PNG, or WEBP files up to 10 MB.
2. **Open camera** for a live device preview and JPEG photo capture.

Camera capture requires HTTPS and user permission. The UI requests the rear-facing camera
when one is available. Captured photos and uploaded files are base64 encoded and sent as
`image_base64` plus `image_mime` in `POST /analyze`.

The backend checks medical relevance before fusing visual evidence with symptom evidence.
If the image is missing or unsuitable, the response clearly identifies text-only mode.

## Production Verification

Before calling a deployment healthy, verify:

1. `GET /health` returns HTTP 200.
2. The website header shows **Analysis service ready**.
3. The intake form enables submission after valid symptom text and body location are entered.
4. Text-only analysis reaches the Reports view.
5. Image upload shows a preview and reaches `/analyze` with image data.
6. Camera capture opens after permission, takes a photo, and shows the same preview state.
7. Results include urgency, possible conditions, clinical assessment, risk signals, red flags, and a recommended next step.
8. Desktop and mobile layouts have no clipping or horizontal overflow.

Verified on July 15, 2026:

- 23 backend tests passed.
- React production build passed.
- Netlify website returned HTTP 200 and connected to the Render API.
- A live symptom assessment completed and rendered the Reports view.
- An image payload reached the production API; a non-medical image was correctly rejected by the medical-relevance gate and safely continued in text-only mode.
- Desktop and 390 x 844 mobile browser checks passed without relevant console errors.

## Safety and Privacy

CliniScan is triage support, not a diagnosis tool. Users should avoid including identifying
information in images. The public interface must continue to display the medical disclaimer
and direct urgent or life-threatening symptoms to emergency services.

Product analytics is first-party and intentionally excludes assessment content. See
[`analytics-privacy.md`](analytics-privacy.md) before changing the tracked event schema or
adding any third-party tracking service.
