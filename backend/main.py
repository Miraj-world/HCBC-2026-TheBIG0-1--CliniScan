from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware

from layers.clinical_reasoning import generate_clinical_reasoning
from layers.ai_gateway import ANTHROPIC_MODEL, OPENAI_MODEL
from layers.evidence_fusion import fuse_evidence
from layers.json_parser import fallback_diagnosis
from layers.quality_gate import assess_data_quality
from layers.safety_override import run_safety_override
from layers.symptom_structurer import DEFAULT_STRUCTURED_OUTPUT, structure_symptoms
from layers.vision_extractor import extract_vision_features
from models.schemas import AnalyzeRequest, FullResponse, SymptomOutput, VisionOutput

load_dotenv()

app = FastAPI(title="CliniScan", version="2.0")


def _allowed_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "").strip()
    if raw:
        return [origin.strip().rstrip("/") for origin in raw.split(",") if origin.strip()]
    return [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def _audio_upload_suffix(filename: str | None, content_type: str | None) -> str:
    suffix = Path(filename or "").suffix.lower()
    if suffix in {".wav", ".webm", ".m4a", ".mp3", ".mp4"}:
        return suffix

    mime_suffixes = {
        "audio/wav": ".wav",
        "audio/x-wav": ".wav",
        "audio/webm": ".webm",
        "audio/mp4": ".m4a",
        "audio/m4a": ".m4a",
        "audio/mpeg": ".mp3",
    }
    return mime_suffixes.get((content_type or "").lower(), ".webm")

app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins(),
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).resolve().parent
CACHE_DIR = BASE_DIR / "cache"


def _provider_key(provider: str) -> str:
    if provider == "openai":
        value = os.getenv("OPENAI_API_KEY", "").strip()
        if not value:
            raise HTTPException(status_code=400, detail="OPENAI_API_KEY is not configured on server")
        return value

    value = os.getenv("ANTHROPIC_API_KEY", "").strip()
    if not value:
        raise HTTPException(status_code=400, detail="ANTHROPIC_API_KEY is not configured on server")
    return value


def _load_demo_cache(scenario: int) -> dict:
    path = CACHE_DIR / f"scenario_{scenario}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Demo scenario {scenario} is not available")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail=f"Demo cache is invalid for scenario {scenario}: {exc}")


def _default_fusion_output(symptom_output: dict, no_image_mode: bool, override: dict) -> dict:
    urgency = "high" if override.get("override_triggered") else "medium"
    return {
        "vision_score": 0.0,
        "text_score": 0.0,
        "total_risk_score": 0.0,
        "urgency": urgency,
        "conflict": {
            "conflict_detected": False,
            "conflict_type": None,
            "text_severity": symptom_output.get("patient_reported_severity", "low"),
            "vision_severity": None if no_image_mode else "low",
            "visual_dominates": False,
        },
        "risk_signals": [
            "Fusion fallback engaged due to a processing error",
            *[
                f"Critical keyword detected: '{item}'"
                for item in override.get("triggered_by", [])
            ],
        ],
        "body_region": symptom_output.get("body_region", "other"),
        "no_image_mode": no_image_mode,
    }


@app.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    openai_key = os.getenv("OPENAI_API_KEY", "").strip()
    anthropic_key = os.getenv("ANTHROPIC_API_KEY", "").strip()

    if not openai_key:
        raise HTTPException(status_code=400, detail="OPENAI_API_KEY not configured")

    try:
        import openai
    except ImportError as exc:
        raise HTTPException(
            status_code=500,
            detail="OpenAI Whisper client is unavailable on server",
        ) from exc

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Audio upload is empty")

    suffix = _audio_upload_suffix(audio.filename, audio.content_type)
    tmp_path = ""
    try:
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
            tmp.write(audio_bytes)
            tmp_path = tmp.name

        try:
            client = openai.OpenAI(api_key=openai_key)
            with open(tmp_path, "rb") as f:
                transcript_result = client.audio.transcriptions.create(
                    model="whisper-1",
                    file=f,
                    response_format="text",
                )
            raw_transcript = str(transcript_result).strip()
        except Exception as exc:
            raise HTTPException(
                status_code=502,
                detail="Whisper transcription unavailable. Please type your symptoms manually.",
            ) from exc
    finally:
        if tmp_path:
            try:
                os.unlink(tmp_path)
            except FileNotFoundError:
                pass

    if not raw_transcript:
        raise HTTPException(status_code=422, detail="No speech detected in audio")

    formatting_prompt = f"""You are a clinical documentation assistant.
A patient has verbally described their symptoms. Convert their spoken words into a clear, structured clinical note.

Rules:
- Write in third person neutral clinical style ("Patient reports...", "Symptoms include...")
- Keep it concise — 2 to 4 sentences maximum
- Preserve all medical detail from the original — do not add anything not mentioned
- Remove filler words, repetition, and casual language
- Never include a diagnosis — observations only
- If the input is unclear or too short, return it cleaned up as-is

Patient's spoken words:
\"{raw_transcript}\"

Return ONLY the clinical note. No preamble, no explanation."""

    clinical_note = raw_transcript
    if anthropic_key:
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": anthropic_key,
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={
                        "model": "claude-sonnet-4-20250514",
                        "max_tokens": 300,
                        "messages": [{"role": "user", "content": formatting_prompt}],
                    },
                )
                resp.raise_for_status()
                content = resp.json().get("content", [])
                if content and content[0].get("text"):
                    clinical_note = content[0]["text"].strip()
        except Exception as exc:
            print(f"[Transcribe] Claude formatting failed: {exc}")

    return {"raw_transcript": raw_transcript, "clinical_note": clinical_note}


@app.post("/analyze")
async def analyze(req: AnalyzeRequest):
    if req.demo_scenario in (1, 2, 3):
        cached = _load_demo_cache(req.demo_scenario)
        try:
            return FullResponse.model_validate(cached).model_dump()
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Demo cache schema mismatch: {exc}")

    provider = req.provider
    api_key = _provider_key(provider)

    override = run_safety_override(req.symptom_text)

    form_data = {
        "symptom_text": req.symptom_text,
        "body_location": req.body_location,
        "duration_days": req.duration_days,
        "severity_score": req.severity_score,
        "age": req.age if req.age is not None else "not provided",
        "known_conditions": req.known_conditions or "none",
        "medications": req.medications or "none",
    }

    symptom_output = dict(DEFAULT_STRUCTURED_OUTPUT)
    symptom_output["body_location"] = req.body_location
    symptom_output["duration_days"] = req.duration_days
    symptom_output["severity_score"] = req.severity_score
    symptom_output["patient_reported_severity"] = (
        "low" if req.severity_score <= 3 else "medium" if req.severity_score <= 6 else "high"
    )

    # Strip data URI prefix if present (e.g., "data:image/jpeg;base64,")
    image_data = req.image_base64 or ""
    if ";base64," in image_data:
        image_data = image_data.split(";base64,")[1]

    vision_output: dict = {}
    no_image_mode = not bool(image_data)
    no_image_reason = "no_image_provided" if no_image_mode else None

    if not no_image_mode:
        vision_task = asyncio.create_task(
            extract_vision_features(image_data, req.image_mime, provider, api_key)
        )
        symptom_task = asyncio.create_task(structure_symptoms(form_data, provider, api_key))

        vision_result, symptom_result = await asyncio.gather(vision_task, symptom_task, return_exceptions=True)

        if isinstance(symptom_result, Exception):
            symptom_output = dict(DEFAULT_STRUCTURED_OUTPUT)
            symptom_output["body_location"] = req.body_location
            symptom_output["duration_days"] = req.duration_days
            symptom_output["severity_score"] = req.severity_score
            symptom_output["text_completeness"] = 0.25
        else:
            symptom_output = symptom_result

        if isinstance(vision_result, Exception):
            no_image_mode = True
            vision_output = {}
            no_image_reason = "vision_processing_error"
        else:
            if not vision_result.get("medical_relevance", True):
                no_image_mode = True
                vision_output = {}
                no_image_reason = "image_not_medically_relevant"
            else:
                vision_output = vision_result
                no_image_reason = None
    else:
        try:
            symptom_output = await structure_symptoms(form_data, provider, api_key)
        except Exception:
            symptom_output = dict(DEFAULT_STRUCTURED_OUTPUT)
            symptom_output["body_location"] = req.body_location
            symptom_output["duration_days"] = req.duration_days
            symptom_output["severity_score"] = req.severity_score
            symptom_output["text_completeness"] = 0.25

    try:
        symptom_output = SymptomOutput.model_validate(symptom_output).model_dump()
    except Exception:
        symptom_output = SymptomOutput.model_validate(DEFAULT_STRUCTURED_OUTPUT).model_dump()

    if vision_output:
        try:
            vision_output = VisionOutput.model_validate(vision_output).model_dump()
        except Exception:
            no_image_mode = True
            vision_output = {}
            no_image_reason = "vision_schema_validation_error"

    try:
        fusion_output = fuse_evidence(symptom_output, vision_output, override, no_image=no_image_mode)
    except Exception:
        fusion_output = _default_fusion_output(symptom_output, no_image_mode, override)

    try:
        quality_output = assess_data_quality(vision_output, symptom_output, no_image_mode)
    except Exception:
        quality_output = {
            "quality_score": 0.5,
            "quality_level": "medium",
            "show_uncertain_badge": True,
        }

    # Layer 3 — RAG Retrieval
    rag_cases = []
    if not override.get("override_triggered"):
        try:
            from layers.rag_retriever import retrieve_similar_cases
            rag_cases = await retrieve_similar_cases(fusion_output, symptom_output, api_key)
        except Exception as e:
            print(f"[RAG] Skipped: {e}")
            rag_cases = []

    # Layer 4 — Clinical Reasoning (now RAG-grounded)
    try:
        try:
            diagnosis = await generate_clinical_reasoning(
                fusion_output, quality_output, provider, api_key, rag_cases=rag_cases
            )
        except TypeError:
            diagnosis = await generate_clinical_reasoning(
                fusion_output, quality_output, provider, api_key
            )
    except Exception:
        diagnosis = fallback_diagnosis()

    payload = {
        "pipeline_stages": {
            "safety_override": override,
            "vision_output": vision_output,
            "symptom_output": symptom_output,
            "fusion_output": fusion_output,
            "quality_output": quality_output,
        },
        "diagnosis": diagnosis,
        "urgency": fusion_output.get("urgency", "medium"),
        "conflict": fusion_output.get("conflict", {}),
        "risk_signals": fusion_output.get("risk_signals", []),
        "quality": quality_output,
        "no_image_mode": no_image_mode,
        "no_image_reason": no_image_reason,
        "demo_mode": False,
    }

    try:
        return FullResponse.model_validate(payload).model_dump()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Response schema validation failed: {exc}")


@app.get("/health")
async def health():
    anthropic_ready = bool(os.getenv("ANTHROPIC_API_KEY", "").strip())
    openai_ready = bool(os.getenv("OPENAI_API_KEY", "").strip())
    return {
        "status": "ok",
        "providers": {
            "anthropic": {"configured": anthropic_ready, "model": ANTHROPIC_MODEL},
            "openai": {"configured": openai_ready, "model": OPENAI_MODEL},
        },
    }
