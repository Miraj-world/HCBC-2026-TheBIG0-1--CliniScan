from __future__ import annotations

import base64
import os
from typing import Any

import httpx
import streamlit as st


DEFAULT_API_URL = "https://cliniscan-api.onrender.com"


def _api_url() -> str:
    try:
        configured = st.secrets.get("CLINISCAN_API_URL", DEFAULT_API_URL)
    except FileNotFoundError:
        configured = DEFAULT_API_URL
    return os.getenv("CLINISCAN_API_URL", str(configured)).rstrip("/")


def _urgency_color(urgency: str) -> str:
    return {"low": "#15803d", "medium": "#b45309", "high": "#b91c1c"}.get(
        urgency.lower(), "#475569"
    )


def _show_list(title: str, values: list[Any]) -> None:
    st.subheader(title)
    if values:
        for value in values:
            st.markdown(f"- {value}")
    else:
        st.caption("None reported.")


def _show_results(result: dict[str, Any]) -> None:
    diagnosis = result.get("diagnosis", {})
    urgency = str(result.get("urgency", "unknown"))
    color = _urgency_color(urgency)

    st.markdown("---")
    st.markdown(
        f'<div style="padding:1rem;border-radius:12px;background:{color}18;'
        f'border:1px solid {color};"><strong style="color:{color};font-size:1.35rem">'
        f'{urgency.upper()} URGENCY</strong></div>',
        unsafe_allow_html=True,
    )

    st.subheader("Recommendation")
    st.write(diagnosis.get("recommendation", "No recommendation returned."))

    conditions = diagnosis.get("possible_conditions", [])
    confidence = diagnosis.get("confidence_levels", [])
    st.subheader("Possible conditions")
    if conditions:
        for index, condition in enumerate(conditions):
            level = confidence[index] if index < len(confidence) else "Unspecified"
            st.markdown(f"- **{condition}** — confidence: {level}")
    else:
        st.caption("No possible conditions returned.")

    left, right = st.columns(2)
    with left:
        _show_list("Clinical reasoning", diagnosis.get("clinical_reasoning", []))
    with right:
        _show_list("Risk signals", result.get("risk_signals", []))

    red_flags = diagnosis.get("red_flags", [])
    if red_flags:
        st.error("Red flags: " + "; ".join(str(item) for item in red_flags))

    quality = result.get("quality", {})
    with st.expander("Assessment details"):
        st.write(f"Quality: {quality.get('quality_level', 'unknown')}")
        if quality.get("quality_score") is not None:
            st.progress(float(quality["quality_score"]))
        if result.get("demo_mode"):
            st.info("This result came from a prebuilt demonstration scenario.")

    st.warning(
        diagnosis.get(
            "disclaimer",
            "Not a diagnosis. Always consult a licensed medical professional.",
        )
    )


st.set_page_config(page_title="CliniScan", page_icon="🩺", layout="wide")
st.title("🩺 CliniScan")
st.caption("Multimodal triage support for symptom intake and urgency guidance")
st.warning(
    "CliniScan is not a diagnosis tool or a replacement for emergency or licensed medical care. "
    "Call emergency services now for severe or life-threatening symptoms."
)

with st.sidebar:
    st.header("How to use")
    st.write("Describe the symptoms, complete the intake fields, and optionally add an image.")
    demo_scenario = st.selectbox(
        "Mode",
        options=[None, 1, 2, 3],
        format_func=lambda value: "Live assessment" if value is None else f"Demo scenario {value}",
        help="Demo scenarios return safe prebuilt examples and do not use your entered details for reasoning.",
    )
    provider = st.selectbox("AI provider", ["anthropic", "openai"])
    st.caption(f"API: {_api_url()}")

with st.form("cliniscan-intake"):
    st.subheader("Symptom intake")
    symptom_text = st.text_area(
        "Describe the symptoms",
        placeholder="Describe what you are experiencing, when it started, and whether it is changing.",
        height=130,
    )
    first, second, third = st.columns(3)
    with first:
        body_location = st.text_input("Body location", placeholder="e.g. left forearm")
        duration_days = st.number_input("Duration (days)", min_value=0, max_value=36500, value=1)
    with second:
        severity_score = st.slider("Pain or severity", 1, 10, 5)
        age = st.number_input("Age (optional)", min_value=0, max_value=130, value=None)
    with third:
        known_conditions = st.text_input("Known conditions (optional)")
        medications = st.text_input("Current medications (optional)")

    image = st.file_uploader(
        "Optional image",
        type=["jpg", "jpeg", "png", "webp"],
        help="Avoid uploading identifying information. Images are sent to the configured CliniScan API.",
    )
    consent = st.checkbox("I understand this is informational support, not a medical diagnosis.")
    submitted = st.form_submit_button("Analyze symptoms", type="primary", use_container_width=True)

if submitted:
    if len(symptom_text.strip()) < 10:
        st.error("Please describe the symptoms using at least 10 characters.")
    elif not body_location.strip():
        st.error("Please enter the body location.")
    elif not consent:
        st.error("Please acknowledge the medical-use notice before continuing.")
    else:
        payload: dict[str, Any] = {
            "symptom_text": symptom_text.strip(),
            "body_location": body_location.strip(),
            "duration_days": int(duration_days),
            "severity_score": int(severity_score),
            "age": int(age) if age is not None else None,
            "known_conditions": known_conditions.strip() or None,
            "medications": medications.strip() or None,
            "provider": provider,
            "demo_scenario": demo_scenario,
        }
        if image is not None:
            payload["image_base64"] = base64.b64encode(image.getvalue()).decode("ascii")
            payload["image_mime"] = image.type or "image/jpeg"

        try:
            with st.spinner("Waking up CliniScan and analyzing the intake…"):
                response = httpx.post(
                    f"{_api_url()}/analyze",
                    json=payload,
                    timeout=120,
                )
                response.raise_for_status()
            _show_results(response.json())
        except httpx.HTTPStatusError as exc:
            detail = exc.response.text[:500]
            st.error(f"CliniScan could not complete the assessment ({exc.response.status_code}). {detail}")
        except (httpx.HTTPError, ValueError) as exc:
            st.error(f"The CliniScan service is temporarily unavailable: {exc}")

