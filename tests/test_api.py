from fastapi.testclient import TestClient

import main


client = TestClient(main.app)


def test_health_endpoint_reports_provider_config_state():
    response = client.get("/health")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"
    assert "providers" in body


def test_default_allowed_origins_are_local_web_clients():
    assert main._allowed_origins() == [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def test_allowed_origins_can_be_configured(monkeypatch):
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://app.example.com/, https://admin.example.com")

    assert main._allowed_origins() == [
        "https://app.example.com",
        "https://admin.example.com",
    ]


def test_audio_upload_suffix_supports_ios_wav_and_m4a():
    assert main._audio_upload_suffix("recording.wav", "audio/wav") == ".wav"
    assert main._audio_upload_suffix("recording.m4a", "audio/mp4") == ".m4a"
    assert main._audio_upload_suffix("recording", "audio/webm") == ".webm"


def test_demo_scenario_uses_cached_response_without_keys():
    response = client.post(
        "/analyze",
        json={
            "symptom_text": "This is demo text input",
            "body_location": "demo",
            "duration_days": 1,
            "severity_score": 3,
            "provider": "anthropic",
            "demo_scenario": 1,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["demo_mode"] is True
    assert "pipeline_stages" in body


def test_missing_provider_key_returns_400(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post(
        "/analyze",
        json={
            "symptom_text": "My symptom text is long enough",
            "body_location": "arm",
            "duration_days": 1,
            "severity_score": 4,
            "provider": "openai",
        },
    )

    assert response.status_code == 400
    assert "OPENAI_API_KEY" in response.json()["detail"]


def test_transcribe_requires_openai_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    response = client.post(
        "/transcribe",
        files={"audio": ("recording.webm", b"fake audio", "audio/webm")},
    )

    assert response.status_code == 400
    assert response.json()["detail"] == "OPENAI_API_KEY not configured"


def test_text_only_analysis_path_with_mocked_layers(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")

    async def fake_structure(form_data, provider, api_key):
        return {
            "primary_symptom": "itch",
            "body_location": form_data["body_location"],
            "body_region": "skin",
            "duration_days": form_data["duration_days"],
            "severity_score": form_data["severity_score"],
            "progression": "stable",
            "associated_symptoms": [],
            "patient_reported_severity": "medium",
            "risk_factors": [],
            "text_completeness": 0.9,
        }

    async def fake_reasoning(fusion_output, quality_output, provider, api_key):
        return {
            "possible_conditions": ["Dermatitis"],
            "confidence_levels": ["Medium"],
            "clinical_reasoning": ["a", "b", "c"],
            "red_flags": [],
            "recommendation": "Monitor symptoms.",
            "disclaimer": "Not a diagnosis. Always consult a licensed medical professional.",
        }

    monkeypatch.setattr(main, "structure_symptoms", fake_structure)
    monkeypatch.setattr(main, "generate_clinical_reasoning", fake_reasoning)

    response = client.post(
        "/analyze",
        json={
            "symptom_text": "My symptom text is long enough",
            "body_location": "arm",
            "duration_days": 2,
            "severity_score": 5,
            "provider": "anthropic",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["no_image_mode"] is True
    assert body["demo_mode"] is False
    assert body["pipeline_stages"]["vision_output"] == {}


def test_image_conflict_path_returns_clinical_sections(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "test-key")

    async def fake_structure(form_data, provider, api_key):
        return {
            "primary_symptom": "rash",
            "body_location": form_data["body_location"],
            "body_region": "skin",
            "duration_days": form_data["duration_days"],
            "severity_score": 2,
            "progression": "worsening",
            "associated_symptoms": ["itching"],
            "patient_reported_severity": "low",
            "risk_factors": [],
            "text_completeness": 0.9,
        }

    async def fake_vision(image_base64, image_mime, provider, api_key):
        return {
            "medical_relevance": True,
            "visual_features": {"primary_color": "red", "border_definition": "irregular"},
            "severity_indicators": {
                "open_wound": False,
                "bleeding": False,
                "swelling": True,
                "spreading": True,
                "discoloration": True,
                "discharge": False,
            },
            "visual_severity": "high",
            "confidence": "high",
            "detected_signs": ["Diffuse redness", "Visible spreading pattern"],
        }

    async def fake_reasoning(fusion_output, quality_output, provider, api_key):
        return {
            "possible_conditions": ["Cellulitis", "Contact dermatitis", "Insect bite reaction"],
            "confidence_levels": ["Medium", "Low", "Low"],
            "clinical_reasoning": [
                "Visual evidence shows spreading redness and swelling.",
                "The patient reports a low-severity rash with itching.",
                "The mismatch pattern supports prompt clinical review.",
            ],
            "red_flags": ["Spreading redness", "Worsening symptoms"],
            "recommendation": "Seek medical attention promptly for an in-person assessment.",
            "disclaimer": "Not a diagnosis. Always consult a licensed medical professional.",
        }

    monkeypatch.setattr(main, "structure_symptoms", fake_structure)
    monkeypatch.setattr(main, "extract_vision_features", fake_vision)
    monkeypatch.setattr(main, "generate_clinical_reasoning", fake_reasoning)

    response = client.post(
        "/analyze",
        json={
            "symptom_text": "My rash is itchy and seems bigger today",
            "body_location": "forearm",
            "duration_days": 3,
            "severity_score": 2,
            "provider": "openai",
            "image_base64": "ZmFrZS1pbWFnZQ==",
            "image_mime": "image/jpeg",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["no_image_mode"] is False
    assert body["conflict"]["conflict_detected"] is True
    assert body["diagnosis"]["possible_conditions"] == [
        "Cellulitis",
        "Contact dermatitis",
        "Insect bite reaction",
    ]
    assert len(body["diagnosis"]["clinical_reasoning"]) == 3
    assert body["diagnosis"]["red_flags"] == ["Spreading redness", "Worsening symptoms"]
    assert "Clinical reasoning model response was unavailable or invalid" not in body["risk_signals"]
