import { useState } from "react";
import { jsPDF } from "jspdf";
import { AlertOctagon, AlertTriangle, ArrowRight, Check, Download, Info, Share2, ShieldAlert, Stethoscope } from "lucide-react";
import ConflictCallout from "./ConflictCallout";
import DisclaimerBanner from "./DisclaimerBanner";
import UrgencyBadge from "./UrgencyBadge";

function normalizeConfidence(confidence) {
  const value = String(confidence || "Medium");
  return `${value.charAt(0).toUpperCase()}${value.slice(1).toLowerCase()}`;
}

function ConditionCard({ name, confidence }) {
  const confidenceLabel = normalizeConfidence(confidence);

  return (
    <article className={`condition-card confidence-border-${confidenceLabel.toLowerCase()}`}>
      <div>
        <span>Possible condition</span>
        <h3>{name}</h3>
      </div>
      <span className={`confidence confidence-${confidenceLabel.toLowerCase()}`}>{confidenceLabel}</span>
    </article>
  );
}

function classifyRiskSignal(signal) {
  const text = String(signal).toLowerCase();
  if (
    text.includes("bleeding") ||
    text.includes("severe") ||
    text.includes("emergency") ||
    text.includes("high") ||
    text.includes("red flag")
  ) {
    return { level: "critical", width: "92%", Icon: AlertOctagon };
  }

  if (
    text.includes("worsening") ||
    text.includes("spreading") ||
    text.includes("discharge") ||
    text.includes("infection") ||
    text.includes("conflict") ||
    text.includes("mismatch") ||
    text.includes("risk")
  ) {
    return { level: "warning", width: "74%", Icon: AlertTriangle };
  }

  return { level: "info", width: "52%", Icon: Info };
}

function RiskSignalRow({ signal }) {
  const { level, width, Icon } = classifyRiskSignal(signal);

  return (
    <li className={`risk-signal-row risk-${level}`}>
      <div className="risk-signal-name">
        <Icon size={18} strokeWidth={2.3} aria-hidden="true" />
        <span>{signal}</span>
      </div>
      <div className="risk-signal-bar" aria-hidden="true">
        <span style={{ width }} />
      </div>
    </li>
  );
}

function EmptyPanel({ children }) {
  return <p className="empty-copy">{children}</p>;
}

export default function ResultsPanel({ data, onReset, onAnalytics }) {
  const [showSubmittedInput, setShowSubmittedInput] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const diagnosis = data.diagnosis || {};
  const quality = data.quality || {};
  const imageFallbackReason = data.no_image_reason;
  const reportInput = data.report_input || {};
  const possibleConditions = Array.isArray(diagnosis.possible_conditions) ? diagnosis.possible_conditions : [];
  const clinicalReasoning = Array.isArray(diagnosis.clinical_reasoning) ? diagnosis.clinical_reasoning : [];
  const riskSignals = Array.isArray(data.risk_signals) ? data.risk_signals : [];
  const redFlags = Array.isArray(diagnosis.red_flags) ? diagnosis.red_flags : [];

  function setTransientMessage(message) {
    setActionMessage(message);
    setTimeout(() => setActionMessage(""), 2600);
  }

  function buildShareText() {
    return [
      `CliniScan Report`,
      `Urgency: ${String(data.urgency || "-").toUpperCase()}`,
      `Recommendation: ${diagnosis.recommendation || "-"}`,
      "",
      `Possible conditions:`,
      ...(possibleConditions.length ? possibleConditions.map((item, idx) => `${idx + 1}. ${item}`) : ["- None"]),
      "",
      `Risk signals:`,
      ...(riskSignals.length ? riskSignals.map((item) => `- ${item}`) : ["- None"]),
      "",
      `Red flags:`,
      ...(redFlags.length ? redFlags.map((item) => `- ${item}`) : ["- None"]),
      "",
      `Submitted input:`,
      `- Body location: ${reportInput.body_location || "-"}`,
      `- Duration: ${reportInput.duration_days ?? "-"} day(s)`,
      `- Pain severity: ${reportInput.severity_score ?? "-"}/10`,
      `- Age: ${reportInput.age ?? "-"}`,
      `- Known conditions: ${reportInput.known_conditions || "-"}`,
      `- Medications: ${reportInput.medications || "-"}`,
    ].join("\n");
  }

  async function handleShare() {
    const shareText = buildShareText();
    try {
      if (navigator.share) {
        await navigator.share({
          title: "CliniScan Report",
          text: shareText,
        });
        onAnalytics?.("report_shared");
        setTransientMessage("Report shared.");
        return;
      }

      await navigator.clipboard.writeText(shareText);
      onAnalytics?.("report_shared");
      setTransientMessage("Report copied to clipboard.");
    } catch (_error) {
      setTransientMessage("Share failed. Please try again.");
    }
  }

  function handleDownloadPdf() {
    try {
      const pdf = new jsPDF({ unit: "pt", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const layout = {
        marginX: 36,
        topY: 34,
        bottomY: pageHeight - 34,
        cardGap: 12,
        lineHeight: 12,
      };
      let y = layout.topY;

      const palette = {
        pageBg: [246, 248, 251],
        headerBg: [15, 118, 110],
        headerInk: [255, 255, 255],
        cardBg: [255, 255, 255],
        cardBorder: [219, 227, 236],
        textMain: [15, 23, 42],
        textMuted: [95, 107, 122],
        warningBg: [255, 251, 235],
        warningBorder: [245, 201, 124],
      };

      function drawPageBase() {
        pdf.setFillColor(...palette.pageBg);
        pdf.rect(0, 0, pageWidth, pageHeight, "F");
      }

      function addPageAndReset() {
        pdf.addPage();
        drawPageBase();
        y = layout.topY;
      }

      function ensureSpace(heightNeeded) {
        if (y + heightNeeded > layout.bottomY) {
          addPageAndReset();
        }
      }

      function drawHeader() {
        const h = 82;
        ensureSpace(h);
        pdf.setFillColor(...palette.headerBg);
        pdf.roundedRect(layout.marginX, y, pageWidth - layout.marginX * 2, h, 8, 8, "F");

        pdf.setTextColor(...palette.headerInk);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(18);
        pdf.text("CliniScan Report", layout.marginX + 14, y + 28);

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.text(`Generated: ${new Date().toLocaleString()}`, layout.marginX + 14, y + 46);
        pdf.text("Triage support only - not a diagnosis", layout.marginX + 14, y + 60);

        const urgency = String(data.urgency || "medium").toLowerCase();
        const urgencyTone = urgency === "high" ? [185, 35, 24] : urgency === "low" ? [21, 128, 61] : [180, 83, 9];
        const badgeW = 114;
        const badgeH = 28;
        const badgeX = pageWidth - layout.marginX - badgeW - 14;
        const badgeY = y + 14;
        pdf.setFillColor(...urgencyTone);
        pdf.roundedRect(badgeX, badgeY, badgeW, badgeH, 14, 14, "F");
        pdf.setTextColor(255, 255, 255);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(11);
        pdf.text(`URGENCY: ${urgency.toUpperCase()}`, badgeX + 12, badgeY + 18);

        y += h + layout.cardGap;
      }

      function drawDisclaimerCard() {
        const h = 46;
        ensureSpace(h);
        pdf.setFillColor(...palette.warningBg);
        pdf.setDrawColor(...palette.warningBorder);
        pdf.roundedRect(layout.marginX, y, pageWidth - layout.marginX * 2, h, 8, 8, "FD");
        pdf.setTextColor(...palette.textMain);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(10);
        pdf.text("Safety Disclaimer", layout.marginX + 12, y + 17);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(10);
        pdf.text("Not a medical diagnosis. Always consult a licensed medical professional.", layout.marginX + 12, y + 31);
        y += h + layout.cardGap;
      }

      function buildWrappedLines(lines, width) {
        const normalized = Array.isArray(lines) ? lines : [String(lines || "-")];
        const wrapped = [];
        normalized.forEach((line) => {
          const parts = pdf.splitTextToSize(String(line || "-"), width);
          wrapped.push(...parts);
        });
        return wrapped.length ? wrapped : ["-"];
      }

      function drawCardSection(title, lines) {
        const cardW = pageWidth - layout.marginX * 2;
        const innerX = layout.marginX + 14;
        const innerW = cardW - 28;
        const wrappedLines = buildWrappedLines(lines, innerW);
        const titleH = 30;
        const maxLinesPerPage = 26;
        let start = 0;
        let sectionIndex = 0;

        while (start < wrappedLines.length) {
          const linesLeft = wrappedLines.length - start;
          const chunkSize = Math.min(linesLeft, maxLinesPerPage);
          const chunk = wrappedLines.slice(start, start + chunkSize);
          const cardH = titleH + 14 + chunk.length * layout.lineHeight;

          ensureSpace(cardH);

          pdf.setFillColor(...palette.cardBg);
          pdf.setDrawColor(...palette.cardBorder);
          pdf.roundedRect(layout.marginX, y, cardW, cardH, 8, 8, "FD");

          pdf.setTextColor(...palette.textMain);
          pdf.setFont("helvetica", "bold");
          pdf.setFontSize(12);
          const sectionTitle = sectionIndex === 0 ? title : `${title} (cont.)`;
          pdf.text(sectionTitle, innerX, y + 20);

          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(10.5);
          let lineY = y + 36;
          chunk.forEach((line) => {
            pdf.text(String(line), innerX, lineY);
            lineY += layout.lineHeight;
          });

          y += cardH + layout.cardGap;
          start += chunkSize;
          sectionIndex += 1;
        }
      }

      function drawImageSection() {
        if (!(reportInput.image_uploaded && reportInput.image_preview_url)) return;
        const cardW = pageWidth - layout.marginX * 2;
        const cardH = 250;
        ensureSpace(cardH);

        pdf.setFillColor(...palette.cardBg);
        pdf.setDrawColor(...palette.cardBorder);
        pdf.roundedRect(layout.marginX, y, cardW, cardH, 8, 8, "FD");
        pdf.setTextColor(...palette.textMain);
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(12);
        pdf.text("Uploaded Image", layout.marginX + 14, y + 20);

        const imgX = layout.marginX + 14;
        const imgY = y + 32;
        const imgW = cardW - 28;
        const imgH = 202;
        const imageType = reportInput.image_preview_url.includes("image/png") ? "PNG" : "JPEG";
        pdf.addImage(reportInput.image_preview_url, imageType, imgX, imgY, imgW, imgH, undefined, "FAST");
        y += cardH + layout.cardGap;
      }

      drawPageBase();
      drawHeader();
      drawDisclaimerCard();
      drawCardSection("Recommended Next Step", [diagnosis.recommendation || "-"]);
      drawCardSection(
        "Possible Conditions",
        possibleConditions.length
          ? possibleConditions.map((item, idx) => `${idx + 1}. ${item}  (Confidence: ${normalizeConfidence(diagnosis.confidence_levels?.[idx] || "Medium")})`)
          : ["None"]
      );
      drawCardSection(
        "Clinical Assessment",
        clinicalReasoning.length
          ? clinicalReasoning.map((item, idx) => `${idx + 1}. ${item}`)
          : ["None"]
      );
      drawCardSection(
        "Risk Signals",
        riskSignals.length ? riskSignals.map((item) => `- ${item}`) : ["None"]
      );
      drawCardSection(
        "Red Flags",
        redFlags.length ? redFlags.map((item) => `- ${item}`) : ["None"]
      );
      drawCardSection("Submitted Input", [
        `Symptom description: ${reportInput.symptom_text || "-"}`,
        `Body location: ${reportInput.body_location || "-"}`,
        `Duration (days): ${reportInput.duration_days ?? "-"}`,
        `Pain severity score: ${reportInput.severity_score ?? "-"}/10`,
        `Age: ${reportInput.age ?? "-"}`,
        `Known conditions: ${reportInput.known_conditions || "-"}`,
        `Current medications: ${reportInput.medications || "-"}`,
        `AI provider: ${reportInput.provider || "-"}`,
      ]);
      drawImageSection();

      pdf.save(`cliniscan-report-${Date.now()}.pdf`);
      onAnalytics?.("report_downloaded");
      setTransientMessage("PDF downloaded.");
    } catch (_error) {
      setTransientMessage("Unable to generate PDF.");
    }
  }

  return (
    <section className="results-layout">
      <div className="results-main">
        <div className="report-toolbar">
          <button type="button" className="report-action-btn" onClick={handleDownloadPdf}>
            <Download size={16} strokeWidth={2.2} aria-hidden="true" />
            <span>Download PDF</span>
          </button>
          <button type="button" className="report-action-btn" onClick={handleShare}>
            <Share2 size={16} strokeWidth={2.2} aria-hidden="true" />
            <span>Share</span>
          </button>
          {actionMessage ? (
            <span className="report-action-message">
              <Check size={14} strokeWidth={2.4} aria-hidden="true" />
              {actionMessage}
            </span>
          ) : null}
        </div>

        <DisclaimerBanner />
        <UrgencyBadge urgency={data.urgency} />
        <ConflictCallout conflict={data.conflict} />

        <section className="card result-card">
          <div className="result-card-header">
            <div>
              <span className="eyebrow">Clinical insight panel</span>
              <h2>Possible conditions</h2>
            </div>
            <p>Educational possibilities to discuss with a clinician. Not a diagnosis.</p>
          </div>

          {possibleConditions.length > 0 ? (
            <div className="condition-grid">
              {possibleConditions.map((condition, index) => (
                <ConditionCard
                  key={`${condition}-${index}`}
                  name={condition}
                  confidence={diagnosis.confidence_levels?.[index] || "Medium"}
                />
              ))}
            </div>
          ) : (
            <EmptyPanel>No possible conditions were returned for this assessment.</EmptyPanel>
          )}
        </section>

        <section className="card result-card assessment-card">
          <div className="result-card-header">
            <div className="clinical-summary-heading">
              <span className="summary-heading-icon">
                <Stethoscope size={24} strokeWidth={2.3} aria-hidden="true" />
              </span>
              <div>
                <span className="eyebrow">Structured summary</span>
                <h2>Clinical assessment</h2>
              </div>
            </div>
          </div>

          {clinicalReasoning.length > 0 ? (
            <ol className="assessment-list">
              {clinicalReasoning.map((line, index) => (
                <li key={`reason-${index}`}>
                  <span>{index + 1}</span>
                  <p>{line}</p>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyPanel>No clinical assessment text was returned.</EmptyPanel>
          )}
        </section>

        {riskSignals.length > 0 ? (
          <section className="card result-card risk-signals-card">
            <div className="result-card-header">
              <div>
                <span className="eyebrow">Evidence fusion</span>
                <h2>Risk signals detected</h2>
              </div>
            </div>
            <ul className="risk-signal-list">
              {riskSignals.map((signal, index) => (
                <RiskSignalRow key={`risk-${index}`} signal={signal} />
              ))}
            </ul>
          </section>
        ) : null}

        {redFlags.length > 0 ? (
          <section className="card result-card red-flags">
            <div className="result-card-header">
              <div className="clinical-summary-heading care-escalation-heading">
                <span className="summary-heading-icon escalation-heading-icon">
                  <ShieldAlert size={24} strokeWidth={2.3} aria-hidden="true" />
                </span>
                <div>
                  <span className="eyebrow">Care escalation</span>
                  <h2>Red flags</h2>
                </div>
              </div>
            </div>
            <ul className="signal-list red-list">
              {redFlags.map((flag, index) => (
                <li key={`flag-${index}`}>
                  <span aria-hidden="true" />
                  <p>{flag}</p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card result-card submitted-input-card">
          <div className="result-card-header">
            <div>
              <span className="eyebrow">Reports view</span>
              <h2>Submitted input</h2>
            </div>
            <button
              type="button"
              className="secondary-button"
              onClick={() => setShowSubmittedInput((value) => !value)}
            >
              {showSubmittedInput ? "Hide uploaded details" : "Show uploaded details"}
            </button>
          </div>

          {showSubmittedInput ? (
            <div className="submitted-input-grid">
              {reportInput.image_uploaded && reportInput.image_preview_url ? (
                <div className="submitted-image">
                  <img src={reportInput.image_preview_url} alt="Uploaded symptom" />
                </div>
              ) : (
                <p className="empty-copy">No image was uploaded for this assessment.</p>
              )}

              <dl className="submitted-fields">
                <div>
                  <dt>Symptom description</dt>
                  <dd>{reportInput.symptom_text || "-"}</dd>
                </div>
                <div>
                  <dt>Body location</dt>
                  <dd>{reportInput.body_location || "-"}</dd>
                </div>
                <div>
                  <dt>Duration (days)</dt>
                  <dd>{reportInput.duration_days ?? "-"}</dd>
                </div>
                <div>
                  <dt>Pain severity score</dt>
                  <dd>{reportInput.severity_score ?? "-"}/10</dd>
                </div>
                <div>
                  <dt>Age</dt>
                  <dd>{reportInput.age ?? "-"}</dd>
                </div>
                <div>
                  <dt>Known conditions</dt>
                  <dd>{reportInput.known_conditions || "-"}</dd>
                </div>
                <div>
                  <dt>Current medications</dt>
                  <dd>{reportInput.medications || "-"}</dd>
                </div>
                <div>
                  <dt>AI provider</dt>
                  <dd>{reportInput.provider || "-"}</dd>
                </div>
              </dl>
            </div>
          ) : (
            <p className="empty-copy">Toggle to view the uploaded image and submitted form values.</p>
          )}
        </section>
      </div>

      <aside className="results-side">
        <section className="next-step-card">
          <span className="eyebrow">Recommended next step</span>
          <h2 className="heading-with-icon">
            {data.urgency === "high" ? "Seek prompt medical care" : "Plan your next care step"}
            <ArrowRight size={24} strokeWidth={2.4} aria-hidden="true" />
          </h2>
          <p>{diagnosis.recommendation || "Seek medical evaluation if symptoms persist or worsen."}</p>
        </section>

        {quality.show_uncertain_badge ? (
          <section className="support-card warning-support">
            <strong>Uncertain triage</strong>
            <p>Input data was limited. A clearer image or more symptom detail may improve the assessment.</p>
          </section>
        ) : null}

        {data.no_image_mode ? (
          <section className="support-card">
            <strong>Text-only mode</strong>
            <p>
              {imageFallbackReason === "no_image_provided"
                ? "No image was provided. The assessment used symptom text only."
                : imageFallbackReason === "image_not_medically_relevant"
                  ? "The uploaded image was not medically relevant, so the assessment used symptom text only."
                  : imageFallbackReason === "vision_processing_error" || imageFallbackReason === "vision_schema_validation_error"
                    ? "The image was received, but visual analysis failed. The assessment used symptom text only."
                    : "No image was used for this assessment."}
            </p>
          </section>
        ) : null}

        <button className="secondary-button full-width" onClick={onReset}>
          Start a new assessment
        </button>
      </aside>
    </section>
  );
}
