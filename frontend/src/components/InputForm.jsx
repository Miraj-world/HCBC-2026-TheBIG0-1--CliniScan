import { useEffect, useMemo, useRef, useState } from "react";
import {
  Calendar,
  Camera,
  CheckCircle2,
  FileImage,
  Loader2,
  MapPin,
  Mic,
  MicOff,
  Thermometer,
  User,
} from "lucide-react";

const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;

export default function InputForm({ onSubmit, error, apiUrl }) {
  const [formData, setFormData] = useState({
    symptom_text: "",
    body_location: "",
    duration_days: 1,
    severity_score: 5,
    age: "",
    known_conditions: "",
    medications: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [imageError, setImageError] = useState("");
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceState, setVoiceState] = useState("idle");
  const [voiceError, setVoiceError] = useState("");
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [voiceToast, setVoiceToast] = useState(null);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const audioChunksRef = useRef([]);
  const voiceResetTimeoutRef = useRef(null);
  const toastTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (imagePreview) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  useEffect(() => {
    const hasVoiceSupport =
      typeof navigator !== "undefined" &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof window !== "undefined" &&
      Boolean(window.isSecureContext) &&
      Boolean(window.MediaRecorder);
    setVoiceSupported(hasVoiceSupport);

    return () => {
      if (voiceResetTimeoutRef.current) {
        clearTimeout(voiceResetTimeoutRef.current);
      }
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (cameraOpen && videoRef.current && cameraStreamRef.current) {
      videoRef.current.srcObject = cameraStreamRef.current;
      videoRef.current.play().catch(() => {
        setCameraError("The camera preview could not start. Try uploading an image instead.");
      });
    }
  }, [cameraOpen]);

  useEffect(() => {
    let interval;
    if (voiceState === "recording") {
      setRecordingSeconds(0);
      interval = setInterval(() => setRecordingSeconds((seconds) => seconds + 1), 1000);
    }

    return () => clearInterval(interval);
  }, [voiceState]);

  useEffect(() => {
    if (voiceState === "recording" && recordingSeconds >= 60) {
      stopRecording();
    }
  }, [recordingSeconds, voiceState]);

  useEffect(() => {
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }

    if (voiceState === "processing") {
      setVoiceToast({ type: "processing", message: "Formatting your symptoms..." });
      return;
    }

    if (voiceState === "success") {
      setVoiceToast({ type: "success", message: "✓ Symptoms captured and formatted" });
      toastTimeoutRef.current = setTimeout(() => setVoiceToast(null), 1500);
      return;
    }

    if (voiceState === "error") {
      setVoiceToast({
        type: "error",
        message: voiceError || "Could not process audio. Please try again.",
      });
      toastTimeoutRef.current = setTimeout(() => setVoiceToast(null), 2500);
      return;
    }

    setVoiceToast(null);
  }, [voiceError, voiceState]);

  const characterCount = formData.symptom_text.trim().length;
  const remainingCharacters = Math.max(10 - characterCount, 0);
  const severityValue = Number(formData.severity_score);
  const severityProgress = `${((severityValue - 1) / 9) * 100}%`;
  const formattedRecordingTime = `${Math.floor(recordingSeconds / 60)}:${String(recordingSeconds % 60).padStart(2, "0")}`;
  const safeApiUrl = (apiUrl || "http://localhost:8000").replace(/\/$/, "");
  const transcribeUrl = `${safeApiUrl}/transcribe`;
  const isVoiceBusy = voiceState === "requesting_permission" || voiceState === "processing" || voiceState === "success";
  const micButtonClass = [
    "voice-mic-button",
    voiceState === "recording" ? "mic-recording" : "",
    voiceState === "requesting_permission" || voiceState === "processing" ? "mic-processing" : "",
    voiceState === "success" ? "mic-success" : "",
    voiceState === "error" ? "mic-error" : "",
  ].filter(Boolean).join(" ");

  const canSubmit = useMemo(() => {
    return (
      formData.symptom_text.trim().length >= 10 &&
      formData.body_location.trim().length > 0 &&
      !isSubmitting
    );
  }, [formData, isSubmitting]);

  function setField(name, value) {
    setFormData((previousData) => ({ ...previousData, [name]: value }));
  }

  function resetVoiceAfter(delay) {
    if (voiceResetTimeoutRef.current) {
      clearTimeout(voiceResetTimeoutRef.current);
    }
    voiceResetTimeoutRef.current = setTimeout(() => setVoiceState("idle"), delay);
  }

  function getVoiceStartErrorMessage(err) {
    const errorName = err?.name || "";

    if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
      return "Microphone permission is blocked. Allow microphone access for this browser and try again.";
    }
    if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
      return "No microphone was found. Connect a microphone or type your symptoms manually.";
    }
    if (errorName === "NotReadableError" || errorName === "TrackStartError") {
      return "The microphone is unavailable. Close other apps using it or check system microphone permissions.";
    }
    if (errorName === "SecurityError" || !window.isSecureContext) {
      return "Microphone recording requires a secure local browser context.";
    }
    if (errorName === "OverconstrainedError") {
      return "The selected microphone does not support the requested recording settings.";
    }

    return "Could not start microphone recording. Please type your symptoms manually.";
  }

  async function startRecording() {
    setVoiceError("");
    setVoiceState("requesting_permission");

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorderOptions =
        typeof window.MediaRecorder.isTypeSupported === "function" &&
        window.MediaRecorder.isTypeSupported("audio/webm")
          ? { mimeType: "audio/webm" }
          : {};
      const mediaRecorder = new window.MediaRecorder(stream, recorderOptions);
      mediaStreamRef.current = stream;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setVoiceState("processing");

        if (audioChunksRef.current.length === 0) {
          setVoiceError("No audio was captured. Please try again.");
          setVoiceState("error");
          resetVoiceAfter(2500);
          return;
        }

        const blob = new Blob(audioChunksRef.current, {
          type: recorderOptions.mimeType || mediaRecorder.mimeType || "audio/webm",
        });
        await submitAudio(blob);
      };

      mediaRecorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setVoiceError("Could not record audio. Please try again.");
        setVoiceState("error");
        resetVoiceAfter(2500);
      };

      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start();
      setVoiceState("recording");
    } catch (err) {
      console.warn("[Voice] Microphone recording could not start", err);
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
      setVoiceError(getVoiceStartErrorMessage(err));
      setVoiceState("error");
      resetVoiceAfter(2500);
    }
  }

  function stopRecording() {
    const mediaRecorder = mediaRecorderRef.current;
    if (mediaRecorder && voiceState === "recording") {
      try {
        if (mediaRecorder.state === "recording") {
          setVoiceState("processing");
          mediaRecorder.stop();
        }
      } catch (_err) {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
        mediaRecorderRef.current = null;
        setVoiceError("Could not stop recording. Please try again.");
        setVoiceState("error");
        resetVoiceAfter(2500);
      }
    }
  }

  function handleMicClick() {
    if (voiceState === "idle" || voiceState === "error") {
      startRecording();
    } else if (voiceState === "recording") {
      stopRecording();
    }
  }

  async function submitAudio(blob) {
    try {
      const formDataPayload = new FormData();
      formDataPayload.append("audio", blob, "recording.webm");

      const response = await fetch(transcribeUrl, {
        method: "POST",
        body: formDataPayload,
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        const detail = String(data.detail || data.message || "");
        if (response.status === 400 && detail.includes("OPENAI_API_KEY")) {
          throw new Error("Voice transcription unavailable — type your symptoms manually");
        }
        throw new Error(detail || "Transcription failed");
      }

      setField("symptom_text", data.clinical_note || data.raw_transcript || "");
      setVoiceState("success");
      resetVoiceAfter(1500);
    } catch (err) {
      const message =
        err.message === "Voice transcription unavailable — type your symptoms manually"
          ? err.message
          : "Could not process audio. Please try again.";
      setVoiceError(message);
      setVoiceState("error");
      resetVoiceAfter(2500);
    }
  }

  function renderMicIcon() {
    if (voiceState === "recording") {
      return <MicOff size={18} strokeWidth={2.4} aria-hidden="true" />;
    }
    if (voiceState === "requesting_permission" || voiceState === "processing") {
      return <Loader2 className="animate-spin" size={18} strokeWidth={2.4} aria-hidden="true" />;
    }
    if (voiceState === "success") {
      return <CheckCircle2 size={18} strokeWidth={2.4} aria-hidden="true" />;
    }
    return <Mic size={18} strokeWidth={2.4} aria-hidden="true" />;
  }

  function selectImageFile(file) {
    setImageError("");
    if (!file) return;

    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setImageError("Upload a JPG, PNG, or WEBP image.");
      return;
    }

    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setImageError("Image must be smaller than 10 MB.");
      return;
    }

    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }

    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  function removeImage() {
    if (imagePreview) {
      URL.revokeObjectURL(imagePreview);
    }
    setImageFile(null);
    setImagePreview("");
    setImageError("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function closeCamera() {
    cameraStreamRef.current?.getTracks().forEach((track) => track.stop());
    cameraStreamRef.current = null;
    setCameraOpen(false);
  }

  async function openCamera() {
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      setCameraError("Camera capture requires a secure browser connection. Upload an image instead.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      cameraStreamRef.current = stream;
      setCameraOpen(true);
    } catch (err) {
      const denied = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError";
      setCameraError(
        denied
          ? "Camera permission was blocked. Allow camera access or upload an image instead."
          : "The camera is unavailable. Try uploading an image instead.",
      );
    }
  }

  function capturePhoto() {
    const video = videoRef.current;
    if (!video?.videoWidth || !video?.videoHeight) {
      setCameraError("The camera is still starting. Wait a moment and try again.");
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setCameraError("The photo could not be captured. Try again or upload an image.");
          return;
        }
        selectImageFile(new File([blob], `cliniscan-photo-${Date.now()}.jpg`, { type: "image/jpeg" }));
        closeCamera();
      },
      "image/jpeg",
      0.9,
    );
  }

  async function submitForm() {
    if (!canSubmit) return;
    setIsSubmitting(true);
    try {
      await onSubmit(formData, imageFile);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="intake-layout">
      <section className="card intake-card">
        <div className="section-heading">
          <span className="eyebrow">Patient intake</span>
          <h2>Symptom Intake</h2>
          <p>
            Describe what is happening, add context, and optionally upload an image for a structured triage summary.
          </p>
        </div>

        {error ? (
          <div className="alert alert-error" role="alert">
            <strong>Analysis could not start.</strong>
            <span>{error}</span>
          </div>
        ) : null}

        <div className="form-grid">
          <div className="field span-2">
            <label className="symptom-label" htmlFor="symptom_text">
              <span>Symptom description *</span>
              {voiceSupported ? (
                <span style={{
                  background: "linear-gradient(135deg, rgba(99,102,241,0.2), rgba(167,139,250,0.2))",
                  border: "1px solid rgba(99,102,241,0.3)",
                  borderRadius: "999px",
                  padding: "2px 10px",
                  fontSize: "0.68rem",
                  color: "#a78bfa",
                  fontWeight: 600,
                  marginLeft: "8px"
                }}>
                  ✦ Voice enabled
                </span>
              ) : null}
            </label>
            <div className="textarea-voice-wrapper">
              <textarea
                id="symptom_text"
                value={formData.symptom_text}
                placeholder="Describe what you are experiencing, when it started, whether it is changing, and any related symptoms."
                onChange={(event) => setField("symptom_text", event.target.value)}
                minLength={10}
                style={voiceSupported ? { paddingBottom: "48px" } : undefined}
              />
              {voiceSupported ? (
                <button
                  type="button"
                  className={micButtonClass}
                  onClick={handleMicClick}
                  disabled={isVoiceBusy}
                  aria-label={voiceState === "recording" ? "Stop voice recording" : "Start voice recording"}
                  title={voiceState === "recording" ? "Stop voice recording" : "Start voice recording"}
                >
                  {renderMicIcon()}
                </button>
              ) : null}
            </div>
            {voiceState === "recording" ? (
              <button type="button" className="recording-pill text-red-400" onClick={stopRecording}>
                <span className="recording-dot" aria-hidden="true" />
                Recording — {formattedRecordingTime} — Click to stop
              </button>
            ) : null}
            {voiceSupported && voiceState === "idle" ? (
              <small className="voice-helper">🎤 Tap to describe your symptoms by voice</small>
            ) : null}
            <small>
              {remainingCharacters > 0
                ? `${remainingCharacters} more character${remainingCharacters === 1 ? "" : "s"} needed`
                : `${characterCount} characters entered`}
            </small>
          </div>

          <label className="field">
            <span className="label-with-icon">
              <MapPin size={17} strokeWidth={2.2} aria-hidden="true" />
              Body location *
            </span>
            <input
              value={formData.body_location}
              placeholder="Left forearm, right eye, chest"
              onChange={(event) => setField("body_location", event.target.value)}
            />
          </label>

          <label className="field">
            <span className="label-with-icon">
              <Calendar size={17} strokeWidth={2.2} aria-hidden="true" />
              Duration
            </span>
            <div className="input-with-unit">
              <input
                type="number"
                min={0}
                max={365}
                value={formData.duration_days}
                onChange={(event) => setField("duration_days", event.target.value)}
              />
              <span>days</span>
            </div>
          </label>

          <div className="field span-2 severity-field">
            <div className="field-row">
              <span className="label-with-icon">
                <Thermometer size={17} strokeWidth={2.2} aria-hidden="true" />
                Severity score
              </span>
              <strong>{severityValue} / 10</strong>
            </div>
            <div className="severity-slider-wrap" style={{ "--severity-progress": severityProgress }}>
              <input
                className="severity-slider"
                aria-label="Severity score"
                type="range"
                min={1}
                max={10}
                value={formData.severity_score}
                onChange={(event) => setField("severity_score", event.target.value)}
              />
            </div>
            <div className="range-labels" aria-hidden="true">
              <span>Mild</span>
              <span>Moderate</span>
              <span>Severe</span>
            </div>
          </div>

          <label className="field">
            <span className="label-with-icon">
              <User size={17} strokeWidth={2.2} aria-hidden="true" />
              Age
            </span>
            <input
              type="number"
              min={0}
              value={formData.age}
              onChange={(event) => setField("age", event.target.value)}
              placeholder="Optional"
            />
          </label>

          <label className="field">
            <span>Known conditions</span>
            <input
              value={formData.known_conditions}
              onChange={(event) => setField("known_conditions", event.target.value)}
              placeholder="Diabetes, asthma, immune condition"
            />
          </label>

          <label className="field span-2">
            <span>Current medications</span>
            <input
              value={formData.medications}
              onChange={(event) => setField("medications", event.target.value)}
              placeholder="Ibuprofen, antibiotics, daily medications"
            />
          </label>
        </div>

        <div className="upload-section">
          <div className="section-subhead">
            <h3 className="upload-heading">
              <Camera size={18} strokeWidth={2.4} aria-hidden="true" />
              Image upload
            </h3>
            <p>Optional. A clear image can help the system compare visual evidence with the symptom description.</p>
          </div>

          {cameraOpen ? (
            <div className="camera-capture-panel">
              <video ref={videoRef} className="camera-preview" playsInline muted aria-label="Camera preview" />
              <div className="camera-actions">
                <button type="button" className="primary-button camera-button" onClick={capturePhoto}>
                  <Camera size={18} strokeWidth={2.4} aria-hidden="true" />
                  Take photo
                </button>
                <button type="button" className="secondary-button" onClick={closeCamera}>
                  Cancel
                </button>
              </div>
            </div>
          ) : null}

          <div
            className={`upload-dropzone ${isDraggingImage ? "dragging" : ""} ${imagePreview ? "has-image" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDraggingImage(true);
            }}
            onDragLeave={() => setIsDraggingImage(false)}
            onDrop={(event) => {
              event.preventDefault();
              setIsDraggingImage(false);
              selectImageFile(event.dataTransfer.files?.[0]);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(event) => selectImageFile(event.target.files?.[0])}
            />

            {imagePreview ? (
              <div className="image-preview-grid">
                <img src={imagePreview} alt="Selected symptom" />
                <div>
                  <strong>{imageFile?.name}</strong>
                  <p>Image ready for visual triage support.</p>
                  <button type="button" className="secondary-button" onClick={removeImage}>
                    Remove image
                  </button>
                </div>
              </div>
            ) : (
              <div className="image-source-options">
                <button type="button" className="upload-prompt" onClick={() => fileInputRef.current?.click()}>
                  <span className="upload-icon" aria-hidden="true">
                    <FileImage size={22} strokeWidth={2.2} />
                  </span>
                  <strong>Upload an image</strong>
                  <small>JPG, PNG, or WEBP. Max 10 MB.</small>
                </button>
                <span className="image-source-divider" aria-hidden="true">or</span>
                <button type="button" className="upload-prompt" onClick={openCamera}>
                  <span className="upload-icon" aria-hidden="true">
                    <Camera size={22} strokeWidth={2.2} />
                  </span>
                  <strong>Open camera</strong>
                  <small>Take a new photo with this device.</small>
                </button>
              </div>
            )}
          </div>

          {imageError || cameraError ? <p className="field-error">{imageError || cameraError}</p> : null}
          {!imagePreview ? <p className="note">No image selected. Text-only triage is supported.</p> : null}
        </div>

        <div className="form-actions">
          <button className="primary-button" onClick={submitForm} disabled={!canSubmit}>
            {isSubmitting ? (
              <>
                <span className="button-spinner" aria-hidden="true" />
                Analyzing...
              </>
            ) : (
              "Analyze Symptoms"
            )}
          </button>
          <p>Results are triage support only and should be reviewed with a licensed professional.</p>
        </div>
      </section>

      <aside className="side-panel">
        <div className="card guidance-card">
          <span className="eyebrow">Workflow</span>
          <h2>How CliniScan works</h2>
          <ol className="step-list">
            <li>
              <span>1</span>
              <div>
                <strong>Describe symptoms</strong>
                <p>Enter the symptom story, location, duration, and severity.</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <strong>Add context</strong>
                <p>Optional image and medical context improve the structured risk picture.</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <strong>Review triage signals</strong>
                <p>See urgency, risk signals, possible conditions, and next steps.</p>
              </div>
            </li>
          </ol>
        </div>

        <div className="card safety-card">
          <span className="eyebrow">Safety posture</span>
          <h2>Triage support, not diagnosis</h2>
          <p>
            CliniScan highlights urgency and care direction. It does not replace medical evaluation or provide a
            clinical diagnosis.
          </p>
        </div>
      </aside>

      {voiceToast ? (
        <div className={`voice-toast voice-toast-${voiceToast.type}`} role={voiceToast.type === "error" ? "alert" : "status"}>
          {voiceToast.message}
        </div>
      ) : null}
    </div>
  );
}
