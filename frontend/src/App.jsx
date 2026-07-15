import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ClipboardList, Cpu, FileText } from "lucide-react";
import logoUrl from "./assets/CliniScanLogo.png";
import InputForm from "./components/InputForm";
import PipelineProgress from "./components/PipelineProgress";
import ResultsPanel from "./components/ResultsPanel";

const STAGES = [
  "Analyzing image...",
  "Structuring symptoms...",
  "Fusing evidence...",
  "Generating clinical reasoning...",
];

const STEP_ITEMS = [
  { label: "Assessment", Icon: ClipboardList },
  { label: "Processing", Icon: Cpu },
  { label: "Reports", Icon: FileText },
];

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:8000";

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const b64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(b64);
    };
    reader.onerror = () => reject(new Error("Unable to read image file"));
    reader.readAsDataURL(file);
  });
}

export default function App() {
  const [view, setView] = useState("input");
  const [currentStage, setCurrentStage] = useState(0);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [backendStatus, setBackendStatus] = useState("checking");

  const timerRef = useRef(null);

  useEffect(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    fetch(`${API_URL}/health`, { signal: controller.signal })
      .then((response) => {
        setBackendStatus(response.ok ? "connected" : "unavailable");
      })
      .catch(() => {
        setBackendStatus("unavailable");
      })
      .finally(() => {
        clearTimeout(timeoutId);
      });

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      controller.abort();
      clearTimeout(timeoutId);
    };
  }, []);

  const status = useMemo(() => ({ apiUrl: API_URL }), []);
  const activeStep = view === "input" ? 0 : view === "processing" ? 1 : 2;

  async function callAnalyze(payload) {
    let res;
    try {
      res = await fetch(`${API_URL}/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (_error) {
      throw new Error(`Unable to reach backend at ${API_URL}. Make sure the API server is running.`);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(body.detail || body.message || `Request failed (${res.status})`);
    }
    return body;
  }

  async function ensureBackendAvailable() {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);
    try {
      const res = await fetch(`${API_URL}/health`, {
        method: "GET",
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error();
      }
    } catch (_error) {
      throw new Error("CliniScan could not reach the analysis service. Please wait a moment and try again.");
    } finally {
      clearTimeout(timeout);
    }
  }

  async function runAnalysis(formData, imageFile) {
    setError(null);
    try {
      await ensureBackendAvailable();
    } catch (err) {
      setError(err.message || "Backend is unreachable");
      setView("input");
      return;
    }
    setView("processing");
    setCurrentStage(0);

    timerRef.current = setInterval(() => {
      setCurrentStage((prev) => (prev < STAGES.length - 1 ? prev + 1 : prev));
    }, 850);

    try {
      let image_base64;
      let image_mime;
      if (imageFile) {
        image_base64 = await toBase64(imageFile);
        image_mime = imageFile.type || "image/jpeg";
      }

      const payload = {
        symptom_text: formData.symptom_text,
        body_location: formData.body_location,
        duration_days: Number(formData.duration_days),
        severity_score: Number(formData.severity_score),
        age: formData.age ? Number(formData.age) : null,
        known_conditions: formData.known_conditions || null,
        medications: formData.medications || null,
        image_base64,
        image_mime,
        provider: "openai",
      };

      const response = await callAnalyze(payload);
      setCurrentStage(STAGES.length - 1);
      setTimeout(() => {
        if (timerRef.current) {
          clearInterval(timerRef.current);
        }
        setResults({
          ...response,
          report_input: {
            symptom_text: payload.symptom_text,
            body_location: payload.body_location,
            duration_days: payload.duration_days,
            severity_score: payload.severity_score,
            age: payload.age,
            known_conditions: payload.known_conditions,
            medications: payload.medications,
            provider: payload.provider,
            image_uploaded: Boolean(image_base64),
            image_preview_url: image_base64 ? `data:${image_mime};base64,${image_base64}` : null,
          },
        });
        setView("results");
      }, 750);
    } catch (err) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      setError(err.message || "Analysis failed");
      setView("input");
    }
  }

  function resetAll() {
    setResults(null);
    setError(null);
    setCurrentStage(0);
    setView("input");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand-lockup">
            <img className="brand-logo" src={logoUrl} alt="CliniScan" />
            <div className="brand-copy">
              <h1>CliniScan</h1>
              <p>Layered multimodal triage workflow.</p>
            </div>
          </div>
          <div className={`api-status status-${backendStatus}`}>
            <span className="status-dot" aria-hidden="true" />
            <span>{backendStatus === "connected" ? "Analysis service ready" : backendStatus === "checking" ? "Waking analysis service" : "Analysis service unavailable"}</span>
            <small>{status.apiUrl}</small>
          </div>
        </div>
      </header>

      <StepIndicator activeStep={activeStep} />

      <main className="page">
        {view === "input" && (
          <InputForm onSubmit={runAnalysis} error={error} apiUrl={API_URL} />
        )}

        {view === "processing" && (
          <PipelineProgress stageIndex={currentStage} stages={STAGES} />
        )}

        {view === "results" && results && (
          <ResultsPanel data={results} onReset={resetAll} />
        )}
      </main>
    </div>
  );
}

function StepIndicator({ activeStep }) {
  return (
    <nav className="step-indicator" aria-label="Assessment progress">
      <div className="step-indicator-inner">
        {STEP_ITEMS.map(({ label, Icon }, index) => {
          const isActive = index === activeStep;
          const isComplete = index < activeStep;
          return (
            <div
              key={label}
              className={`top-step ${isActive ? "active" : ""} ${isComplete ? "complete" : ""}`}
            >
              <span className="top-step-icon" aria-hidden="true">
                {isComplete ? <Check size={16} strokeWidth={2.6} /> : <Icon size={17} strokeWidth={2.3} />}
              </span>
              <span>{label}</span>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
