import "./style.css";
import { toPng } from "html-to-image";
import JSZip from "jszip";

// ---------- State / settings (Phase 3) ----------
interface Settings {
  font: string;
  blur: number; // blur for 100px font
  weight: string;
  tracking: number; // em
  leading: number;
  width: number; // % of stage
  autofit: boolean;
  size: number; // px, if not auto
  lowercase: boolean;
  justifyLast: boolean;
  color: string;
  bg: string;
  // Creative
  bgType: "solid" | "gradient" | "image";
  bg2: string;
  bgAngle: number;
  bgImage: string; // data URL
  glow: number; // px (ref. 540), 0 = off
  glowColor: string;
  outline: number; // px (ref. 540), 0 = off
  outlineColor: string;
  rotate: number; // deg
}

const DEFAULTS: Settings = {
  font: "arial_narrowregular, 'Arial Narrow', sans-serif",
  blur: 2, // px of blur for a 500px box (exact brat value)
  weight: "500",
  tracking: 0,
  leading: 0, // 0 = line-height "normal" (like brat)
  width: 100,
  autofit: true,
  size: 170, // max size in auto mode (like brat), or fixed size otherwise
  lowercase: true,
  justifyLast: true,
  color: "#ffffff",
  bg: "#000000",
  bgType: "solid",
  bg2: "#8ace00",
  bgAngle: 90,
  bgImage: "",
  glow: 0,
  glowColor: "#8ace00",
  outline: 0,
  outlineColor: "#000000",
  rotate: 0,
};

const STORE_KEY = "brat-lyrics-settings-v8";
const load = (): Settings => {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
};
let settings = load();
const save = () => {
  // don't persist background image (potentially large data URL)
  const { bgImage, ...rest } = settings;
  void bgImage;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(rest));
  } catch {
    /* quota */
  }
};

// ---------- Elements ----------
const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const stage = $("#stage") as HTMLDivElement;
const lyrics = $("#lyrics") as HTMLDivElement;
const input = $("#text-input") as HTMLInputElement;

let currentText = "";

// ---------- Render core (Phase 1) ----------
/**
 * Place `text` in `el` contained in a `box`.
 * Reproduces the brat look: lowercase, justified (including last line),
 * slight blur, and auto size to fill the box.
 */
function layoutInto(el: HTMLElement, boxW: number, boxH: number, text: string) {
  // Everything is defined for a 500px reference box (like brat), then
  // scaled -> preview and export (any resolution) are identical.
  const containerW = Math.round((boxW * settings.width) / 100);
  const containerH = Math.round(boxH);
  // Everything is aligned to brat's reference box (540×340, padding 20,
  // text area 500×300). scale = box width / 540.
  const scale = containerW / BOX_W;
  const pad = Math.round(20 * scale); // brat: padding 20
  const maxFont = Math.max(8, settings.size * scale); // brat minFontSize 8

  // Container (equivalent to #textOverlay): normal block + justify.
  el.style.boxSizing = "border-box";
  el.style.position = "relative";
  el.style.overflow = "hidden";
  el.style.width = `${containerW}px`;
  el.style.height = `${containerH}px`;
  el.style.padding = `${pad}px`;
  el.style.textAlign = "justify";
  const last = settings.justifyLast ? "justify" : "left";
  (el.style as any).textAlignLast = last;
  (el.style as any).webkitTextAlignLast = last;

  // Internal inline-block span IN NORMAL FLOW (exactly .textFitted from brat):
  // its width = longest line, and justify spreads other lines to that width.
  // No word is ever broken.
  let span = el.querySelector("span.fitted") as HTMLElement | null;
  if (!span) {
    span = document.createElement("span");
    span.className = "fitted";
    el.innerHTML = "";
    el.appendChild(span);
  }
  span.textContent = text || "";
  span.style.display = "inline-block";
  // NO max-width: the span (inline-block) naturally limits to the container's
  // content width, and an overly long word overflows -> detected by
  // getBoundingClientRect in fitFontSize (like real textFit).
  span.style.fontFamily = settings.font;
  span.style.fontWeight = settings.weight;
  span.style.letterSpacing = `${settings.tracking}em`;
  // 0 = line-height 1 (like brat: `html body { line-height: 1 }`); otherwise value
  span.style.lineHeight = settings.leading > 0 ? String(settings.leading) : "1";
  span.style.color = settings.color;
  span.style.textTransform = settings.lowercase ? "lowercase" : "none";
  (span.style as any).overflowWrap = "normal";
  (span.style as any).wordBreak = "normal";
  span.style.whiteSpace = "normal";

  const availW = containerW - pad * 2;
  const availH = containerH - pad * 2;

  let fontSize = maxFont;
  if (settings.autofit && text.trim()) {
    fontSize = fitFontSize(span, availW, availH, maxFont);
  }
  span.style.fontSize = `${fontSize}px`;

  // brat aligns text AT THE TOP of the box (textFit alignVert:false):
  // uniform padding, no vertical centering.

  // Blur like brat: 2px on a 500px box, scaled
  const blurPx = settings.blur * scale;
  span.style.filter = blurPx > 0 ? `blur(${blurPx}px)` : "none";

  // ---- Creative (applied AFTER measurement to not skew fitFontSize) ----
  const glowPx = settings.glow * scale;
  span.style.textShadow = glowPx > 0
    ? `0 0 ${glowPx}px ${settings.glowColor}, 0 0 ${glowPx * 2}px ${settings.glowColor}`
    : "none";
  const strokePx = settings.outline * scale;
  (span.style as any).webkitTextStroke = strokePx > 0 ? `${strokePx}px ${settings.outlineColor}` : "";
  span.style.transform = settings.rotate ? `rotate(${settings.rotate}deg)` : "";
  span.style.transformOrigin = "center";
}

/** CSS background value based on type (solid / gradient / image). */
function backgroundCss(): string {
  if (settings.bgType === "gradient")
    return `linear-gradient(${settings.bgAngle}deg, ${settings.bg}, ${settings.bg2})`;
  if (settings.bgType === "image" && settings.bgImage)
    return `${settings.bg} url("${settings.bgImage}") center / cover no-repeat`;
  return settings.bg;
}

/**
 * Binary search for the largest font (<= maxSize) where the span fits
 * in the box IN WIDTH AND HEIGHT. Exact copy of textFit algorithm:
 * since the span is inline-block, scrollWidth = longest line width
 * -> no word is ever broken, and justify relies on this width.
 */
function fitFontSize(span: HTMLElement, availW: number, availH: number, maxSize: number): number {
  let low = 8; // brat minFontSize
  let high = Math.round(maxSize);
  let size = low;
  while (low <= high) {
    const mid = (low + high) >> 1;
    span.style.fontSize = `${mid}px`;
    // brat measures via getBoundingClientRect (width = longest line)
    const r = span.getBoundingClientRect();
    if (r.width <= availW && r.height <= availH) {
      size = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return size;
}

/**
 * The #stage has the EXACT format of brat's white box: text area
 * 500×300 + padding 20 => box 540×340 (ratio 5:3-ish). At the largest fitting size.
 */
const BOX_W = 540;
const BOX_H = 340;
function sizeStage() {
  const wrap = document.getElementById("stage-area") as HTMLElement;
  const availW = wrap.clientWidth - 48;
  const availH = wrap.clientHeight - 48;
  const ar = BOX_W / BOX_H;
  let w = availW;
  let h = w / ar;
  if (h > availH) {
    h = availH;
    w = h * ar;
  }
  stage.style.width = `${Math.round(w)}px`;
  stage.style.height = `${Math.round(h)}px`;
}

function render() {
  sizeStage();
  stage.style.background = backgroundCss();
  layoutInto(lyrics, stage.clientWidth, stage.clientHeight, currentText);
}

// ---------- Step breakdown (Phase 2) ----------
type Mode = "cumulative" | "word" | "line";
type Unit = "word" | "char";

function buildSteps(text: string, mode: Mode, unit: Unit): string[] {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t) return [];

  if (mode === "line") return cumulativeLines(t);

  if (unit === "char") {
    // one image per visible character added (always cumulative)
    const steps: string[] = [];
    for (let i = 0; i < t.length; i++) {
      if (t[i] === " ") continue;
      steps.push(t.slice(0, i + 1));
    }
    return steps;
  }

  const tokens = t.split(" ");
  if (mode === "word") return tokens; // one isolated word per image
  // cumulative: +1 word per image
  return tokens.map((_, i) => tokens.slice(0, i + 1).join(" "));
}

/** Detects actual lines from complete render and returns line-by-line cumulative. */
function cumulativeLines(text: string): string[] {
  const words = text.split(" ");
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  stage.appendChild(probe);
  layoutInto(probe, stage.clientWidth, stage.clientHeight, text);
  const fitted = probe.querySelector("span.fitted") as HTMLElement;
  fitted.innerHTML = words.map((w) => `<span>${w}</span>`).join(" ");
  const spans = [...fitted.querySelectorAll("span")] as HTMLElement[];
  const lines: string[][] = [];
  let lastTop = -Infinity;
  spans.forEach((s, i) => {
    if (s.offsetTop - lastTop > 2) {
      lines.push([]);
      lastTop = s.offsetTop;
    }
    lines[lines.length - 1].push(words[i]);
  });
  probe.remove();
  return lines.map((_, i) => lines.slice(0, i + 1).flat().join(" "));
}

// ---------- Export images (Phase 2) ----------
async function renderFrame(text: string, w: number, h: number, transparent: boolean): Promise<string> {
  // html-to-image doesn't capture an off-screen node (empty render) and applies
  // all transform:scale in the output. So we render the node at its actual
  // size, on screen (0,0), hidden by the export overlay.
  const node = document.createElement("div");
  node.style.cssText = `position:fixed;left:0;top:0;width:${w}px;height:${h}px;display:flex;align-items:center;justify-content:center;overflow:hidden;z-index:2147483000;`;
  node.style.background = transparent ? "transparent" : backgroundCss();
  const inner = document.createElement("div");
  node.appendChild(inner);
  document.body.appendChild(node);
  layoutInto(inner, w, h, text);
  try {
    return await toPng(node, {
      width: w,
      height: h,
      pixelRatio: 1,
      backgroundColor: transparent ? undefined : settings.bg,
      cacheBust: true,
    });
  } finally {
    node.remove();
  }
}

async function exportSequence() {
  const preset = { w: 1080, h: Math.round((1080 * BOX_H) / BOX_W) }; // format brat 540:340
  const mode = ($("#e-mode") as HTMLSelectElement).value as Mode;
  const unit = ($("#e-unit") as HTMLSelectElement).value as Unit;
  const transparent = ($("#e-transparent") as HTMLInputElement).checked;
  const steps = buildSteps(currentText, mode, unit);
  const status = $("#export-status");
  const btn = $("#btn-export") as HTMLButtonElement;

  if (!steps.length) {
    status.textContent = "Write some lyrics first.";
    return;
  }
  btn.disabled = true;

  // Opaque overlay to hide frames rendered on screen during export
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:#0e0e0e;z-index:2147483600;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;color:#8ace00;font:600 22px -apple-system,sans-serif;";
  const label = document.createElement("div");
  overlay.appendChild(label);
  document.body.appendChild(overlay);

  try {
    const zip = new JSZip();
    const pad = String(steps.length).length;
    for (let i = 0; i < steps.length; i++) {
      label.textContent = `Rendering ${i + 1}/${steps.length}…`;
      const dataUrl = await renderFrame(steps[i], preset.w, preset.h, transparent);
      zip.file(`frame_${String(i + 1).padStart(pad, "0")}.png`, dataUrl.split(",")[1], {
        base64: true,
      });
    }
    label.textContent = "Compressing…";
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `brat-lyrics_${steps.length}-frames.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    status.textContent = `✓ ${steps.length} images exported.`;
  } catch (e) {
    status.textContent = "Export error: " + (e as Error).message;
  } finally {
    overlay.remove();
    btn.disabled = false;
  }
}

function previewSteps() {
  const mode = ($("#e-mode") as HTMLSelectElement).value as Mode;
  const unit = ($("#e-unit") as HTMLSelectElement).value as Unit;
  const steps = buildSteps(currentText, mode, unit);
  const wrap = $("#seq-preview");
  wrap.innerHTML = "";
  // Real mini-renders (same engine), in brat 5:3 format
  const thumbW = 168;
  const thumbH = Math.round((thumbW * BOX_H) / BOX_W);
  steps.slice(0, 24).forEach((s) => {
    const thumb = document.createElement("div");
    thumb.className = "thumb";
    thumb.style.width = `${thumbW}px`;
    thumb.style.height = `${thumbH}px`;
    thumb.style.background = backgroundCss();
    const inner = document.createElement("div");
    thumb.appendChild(inner);
    wrap.appendChild(thumb);
    layoutInto(inner, thumbW, thumbH, s);
  });
  updateHint(steps.length);
}

function updateHint(count?: number) {
  const mode = ($("#e-mode") as HTMLSelectElement).value as Mode;
  const unit = ($("#e-unit") as HTMLSelectElement).value as Unit;
  const n = count ?? buildSteps(currentText, mode, unit).length;
  $("#export-hint").textContent = `${n} image(s) will be generated, numbered frame_001…`;
}

// ---------- UI binding (Phase 3) ----------
function bindControls() {
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => {
    settings[k] = v;
    save();
    render();
    syncValueLabels();
  };
  const el = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

  (el("#c-font") as HTMLSelectElement).value = settings.font;
  (el("#c-weight") as HTMLSelectElement).value = settings.weight;
  (el("#c-blur") as HTMLInputElement).value = String(settings.blur);
  (el("#c-tracking") as HTMLInputElement).value = String(settings.tracking);
  (el("#c-leading") as HTMLInputElement).value = String(settings.leading);
  (el("#c-width") as HTMLInputElement).value = String(settings.width);
  (el("#c-size") as HTMLInputElement).value = String(settings.size);
  (el("#c-autofit") as HTMLInputElement).checked = settings.autofit;
  (el("#c-lowercase") as HTMLInputElement).checked = settings.lowercase;
  (el("#c-justify-last") as HTMLInputElement).checked = settings.justifyLast;
  (el("#c-color") as HTMLInputElement).value = settings.color;
  (el("#c-bg") as HTMLInputElement).value = settings.bg;
  (el("#c-bgtype") as HTMLSelectElement).value = settings.bgType;
  (el("#c-bg2") as HTMLInputElement).value = settings.bg2;
  (el("#c-bgangle") as HTMLInputElement).value = String(settings.bgAngle);
  (el("#c-glow") as HTMLInputElement).value = String(settings.glow);
  (el("#c-glowcolor") as HTMLInputElement).value = settings.glowColor;
  (el("#c-outline") as HTMLInputElement).value = String(settings.outline);
  (el("#c-outlinecolor") as HTMLInputElement).value = settings.outlineColor;
  (el("#c-rotate") as HTMLInputElement).value = String(settings.rotate);

  el("#c-font").addEventListener("change", (e) => set("font", (e.target as HTMLSelectElement).value));
  el("#c-weight").addEventListener("change", (e) => set("weight", (e.target as HTMLSelectElement).value));
  el("#c-blur").addEventListener("input", (e) => set("blur", +(e.target as HTMLInputElement).value));
  el("#c-tracking").addEventListener("input", (e) => set("tracking", +(e.target as HTMLInputElement).value));
  el("#c-leading").addEventListener("input", (e) => set("leading", +(e.target as HTMLInputElement).value));
  el("#c-width").addEventListener("input", (e) => set("width", +(e.target as HTMLInputElement).value));
  el("#c-size").addEventListener("input", (e) => set("size", +(e.target as HTMLInputElement).value));
  el("#c-autofit").addEventListener("change", (e) => set("autofit", (e.target as HTMLInputElement).checked));
  el("#c-lowercase").addEventListener("change", (e) => set("lowercase", (e.target as HTMLInputElement).checked));
  el("#c-justify-last").addEventListener("change", (e) => set("justifyLast", (e.target as HTMLInputElement).checked));
  el("#c-color").addEventListener("input", (e) => set("color", (e.target as HTMLInputElement).value));
  el("#c-bg").addEventListener("input", (e) => set("bg", (e.target as HTMLInputElement).value));
  el("#c-bgtype").addEventListener("change", (e) => set("bgType", (e.target as HTMLSelectElement).value as Settings["bgType"]));
  el("#c-bg2").addEventListener("input", (e) => set("bg2", (e.target as HTMLInputElement).value));
  el("#c-bgangle").addEventListener("input", (e) => set("bgAngle", +(e.target as HTMLInputElement).value));
  el("#c-glow").addEventListener("input", (e) => set("glow", +(e.target as HTMLInputElement).value));
  el("#c-glowcolor").addEventListener("input", (e) => set("glowColor", (e.target as HTMLInputElement).value));
  el("#c-outline").addEventListener("input", (e) => set("outline", +(e.target as HTMLInputElement).value));
  el("#c-outlinecolor").addEventListener("input", (e) => set("outlineColor", (e.target as HTMLInputElement).value));
  el("#c-rotate").addEventListener("input", (e) => set("rotate", +(e.target as HTMLInputElement).value));
  el("#c-bgimage").addEventListener("change", (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      settings.bgImage = String(reader.result);
      settings.bgType = "image";
      (el("#c-bgtype") as HTMLSelectElement).value = "image";
      render();
    };
    reader.readAsDataURL(f);
  });

  el("#reset-style").addEventListener("click", () => {
    settings = { ...DEFAULTS };
    save();
    bindControls();
    render();
  });
}

function syncValueLabels() {
  const t = (id: string, v: string | number) => {
    const e = document.getElementById(id);
    if (e) e.textContent = String(v);
  };
  t("v-blur", settings.blur.toFixed(1));
  t("v-tracking", settings.tracking.toFixed(3));
  t("v-leading", settings.leading.toFixed(2));
  t("v-width", `${settings.width}%`);
  t("v-size", `${settings.size}px`);
  t("v-bgangle", `${settings.bgAngle}°`);
  t("v-glow", String(settings.glow));
  t("v-outline", settings.outline.toFixed(1));
  t("v-rotate", `${settings.rotate}°`);
}

// ---------- Sync (tap) + video export ----------
interface Token {
  label: string; // what's displayed in the chip
  cum: string; // accumulated text to display when this token appears
  time: number | null; // instant (s) when it appears
}
const audioEl = document.getElementById("sync-audio") as HTMLAudioElement;
let tokens: Token[] = [];
let tapIndex = 0; // next token to tap
let mediaSource: MediaElementAudioSourceNode | null = null; // createMediaElementSource: 1 time only

/** Splits current text into tokens (words or lines) for sync. */
function buildTokens() {
  const gran = ($("#sync-granularity") as HTMLSelectElement).value;
  const t = currentText.trim().replace(/\s+/g, " ");
  tokens = [];
  tapIndex = 0;
  if (!t) {
    renderTokens();
    return;
  }
  if (gran === "line") {
    const groups = detectLineGroups(t);
    let acc: string[] = [];
    groups.forEach((g) => {
      acc = acc.concat(g);
      tokens.push({ label: g.join(" "), cum: acc.join(" "), time: null });
    });
  } else {
    const words = t.split(" ");
    words.forEach((w, i) => {
      tokens.push({ label: w, cum: words.slice(0, i + 1).join(" "), time: null });
    });
  }
  renderTokens();
}

/** Groups of words per line, detected from actual render (like cumulativeLines). */
function detectLineGroups(text: string): string[][] {
  const words = text.split(" ");
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  stage.appendChild(probe);
  layoutInto(probe, stage.clientWidth, stage.clientHeight, text);
  const fitted = probe.querySelector("span.fitted") as HTMLElement;
  fitted.innerHTML = words.map((w) => `<span>${w}</span>`).join(" ");
  const spans = [...fitted.querySelectorAll("span")] as HTMLElement[];
  const lines: string[][] = [];
  let lastTop = -Infinity;
  spans.forEach((s, i) => {
    if (s.offsetTop - lastTop > 2) {
      lines.push([]);
      lastTop = s.offsetTop;
    }
    lines[lines.length - 1].push(words[i]);
  });
  probe.remove();
  return lines;
}

function renderTokens() {
  const wrap = $("#tap-tokens");
  wrap.innerHTML = tokens
    .map((tk, i) => {
      const cls = tk.time != null ? "done" : i === tapIndex ? "next" : "";
      const t = tk.time != null ? `<span class="t">${tk.time.toFixed(2)}s</span>` : "";
      return `<span class="tok ${cls}">${tk.label}${t}</span>`;
    })
    .join("");
  const done = tokens.filter((t) => t.time != null).length;
  $("#tap-progress").textContent = tokens.length
    ? `${done}/${tokens.length} synced${tapIndex < tokens.length ? ` · next: « ${tokens[tapIndex].label} »` : " · done ✓"}`
    : "Write some lyrics first.";
}

function tap() {
  if (tapIndex >= tokens.length) return;
  const now = audioEl.src ? audioEl.currentTime : 0;
  tokens[tapIndex].time = now;
  tapIndex++;
  renderTokens();
}
function undoTap() {
  if (tapIndex === 0) return;
  tapIndex--;
  tokens[tapIndex].time = null;
  renderTokens();
}
function resetTaps() {
  tokens.forEach((t) => (t.time = null));
  tapIndex = 0;
  renderTokens();
}

/** Renders a state (accumulated text) into HTMLImageElement at desired resolution. */
async function renderStateImage(text: string, w: number, h: number): Promise<HTMLImageElement> {
  const url = await renderFrame(text, w, h, false);
  return await new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.src = url;
  });
}

async function exportVideo() {
  const status = $("#video-status");
  const btn = $("#btn-export-video") as HTMLButtonElement;
  const timed = tokens.filter((t) => t.time != null);
  if (timed.length < 1) {
    status.textContent = "Sync at least one word first (Tap).";
    return;
  }
  btn.disabled = true;
  try {
    const res = +($("#v-res") as HTMLSelectElement).value;
    const W = res;
    const H = Math.round((res * BOX_H) / BOX_W);
    const anim = ($("#v-anim") as HTMLSelectElement).value;
    const withAudio = ($("#v-audio") as HTMLInputElement).checked && !!audioEl.src;

    // Pre-render each state
    status.textContent = "Pre-rendering images…";
    const imgs: HTMLImageElement[] = [];
    for (let i = 0; i < tokens.length; i++) {
      status.textContent = `Pre-rendering ${i + 1}/${tokens.length}…`;
      imgs.push(await renderStateImage(tokens[i].cum, W, H));
    }

    // Canvas + flux
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = settings.bg;
    ctx.fillRect(0, 0, W, H);
    const fps = 30;
    const stream = canvas.captureStream(fps) as MediaStream;

    let audioCtx: AudioContext | null = null;
    if (withAudio) {
      audioCtx = new AudioContext();
      if (!mediaSource) mediaSource = audioCtx.createMediaElementSource(audioEl);
      const dest = audioCtx.createMediaStreamDestination();
      mediaSource.connect(dest);
      mediaSource.connect(audioCtx.destination);
      stream.addTrack(dest.stream.getAudioTracks()[0]);
    }

    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    const onsets = tokens.map((t) => t.time);
    const lastTime = Math.max(...timed.map((t) => t.time as number));
    const tail = 1.5;
    const endTime = withAudio && isFinite(audioEl.duration) ? audioEl.duration : lastTime + tail;
    const TRANS = 0.16; // durée d'apparition (s)
    const clock0 = performance.now();
    const now = () => (withAudio ? audioEl.currentTime : (performance.now() - clock0) / 1000);
    const ease = (p: number) => p * p * (3 - 2 * p); // smoothstep

    function drawState(idx: number, prog: number) {
      // état précédent (dessous) pendant la transition
      if (prog < 1 && idx > 0) {
        ctx.globalAlpha = 1;
        ctx.filter = "none";
        ctx.drawImage(imgs[idx - 1], 0, 0, W, H);
      }
      const e = ease(prog);
      if (anim === "blur") {
        ctx.globalAlpha = e;
        ctx.filter = `blur(${(1 - e) * (W * 0.02)}px)`;
        ctx.drawImage(imgs[idx], 0, 0, W, H);
      } else if (anim === "fade") {
        ctx.globalAlpha = e;
        ctx.filter = "none";
        ctx.drawImage(imgs[idx], 0, 0, W, H);
      } else if (anim === "pop") {
        const s = 1 + (1 - e) * 0.08;
        const dw = W * s,
          dh = H * s;
        ctx.globalAlpha = e;
        ctx.filter = "none";
        ctx.drawImage(imgs[idx], (W - dw) / 2, (H - dh) / 2, dw, dh);
      } else {
        ctx.globalAlpha = 1;
        ctx.filter = "none";
        ctx.drawImage(imgs[idx], 0, 0, W, H);
      }
      ctx.globalAlpha = 1;
      ctx.filter = "none";
    }

    let raf = 0;
    const draw = () => {
      const t = now();
      ctx.fillStyle = settings.bg;
      ctx.fillRect(0, 0, W, H);
      // dernier token dont l'onset <= t
      let idx = -1;
      for (let i = 0; i < onsets.length; i++) {
        if (onsets[i] != null && (onsets[i] as number) <= t) idx = i;
      }
      if (idx >= 0) {
        const onset = onsets[idx] as number;
        const prog = anim === "none" ? 1 : Math.min(1, (t - onset) / TRANS);
        drawState(idx, prog);
      }
      if (t < endTime) raf = requestAnimationFrame(draw);
      else {
        cancelAnimationFrame(raf);
        rec.stop();
      }
    };

    rec.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `brat-lyrics-video_${tokens.length}words.webm`;
      a.click();
      URL.revokeObjectURL(a.href);
      if (audioCtx) audioCtx.close();
      status.textContent = `✓ Video exported (${Math.round(endTime)}s).`;
      btn.disabled = false;
    };

    status.textContent = "Recording in real time…";
    if (withAudio) {
      audioEl.currentTime = 0;
      await audioEl.play().catch(() => {});
    }
    rec.start();
    draw();
  } catch (e) {
    status.textContent = "Error: " + (e as Error).message;
    btn.disabled = false;
  }
}

// ---------- Filmstrip (slides / phrases) ----------
interface Slide {
  text: string;
}
let slides: Slide[] = [];
let activeSlide = 0;
let dragFrom: number | null = null;

const SLIDES_KEY = "brat-lyrics-slides-v1";
const saveSlides = () => {
  try {
    localStorage.setItem(SLIDES_KEY, JSON.stringify({ slides, activeSlide }));
  } catch {
    /* quota */
  }
};

function slug(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .slice(0, 6)
    .join("-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "phrase";
}

function selectSlide(i: number) {
  if (!slides.length) slides.push({ text: "" });
  activeSlide = Math.max(0, Math.min(i, slides.length - 1));
  currentText = slides[activeSlide].text;
  input.value = currentText;
  render();
  buildTokens();
  renderFilm();
  saveSlides();
}

function addSlide() {
  slides.push({ text: "" });
  selectSlide(slides.length - 1);
  input.focus();
}

function removeSlide(i: number) {
  slides.splice(i, 1);
  if (!slides.length) slides.push({ text: "" });
  if (activeSlide >= slides.length) activeSlide = slides.length - 1;
  selectSlide(activeSlide);
}

function moveSlide(from: number, to: number) {
  if (to < 0 || to >= slides.length || from === to) return;
  const [s] = slides.splice(from, 1);
  slides.splice(to, 0, s);
  activeSlide = to;
  renderFilm();
  saveSlides();
}

function renderFilm() {
  const list = $("#film-list");
  list.innerHTML = "";
  slides.forEach((sl, i) => {
    const thumb = document.createElement("div");
    thumb.className = "film-thumb" + (i === activeSlide ? " active" : "");
    thumb.draggable = true;
    thumb.innerHTML = `<span class="idx">${i + 1}</span><button class="del" title="Supprimer">×</button>`;
    const canvas = document.createElement("div");
    canvas.className = "canvas";
    canvas.style.background = backgroundCss();
    const inner = document.createElement("div");
    canvas.appendChild(inner);
    thumb.appendChild(canvas);
    list.appendChild(thumb);
    layoutInto(inner, 148, 93, sl.text);

    thumb.addEventListener("click", () => selectSlide(i));
    thumb.querySelector(".del")!.addEventListener("click", (e) => {
      e.stopPropagation();
      removeSlide(i);
    });
    thumb.addEventListener("dragstart", (e) => {
      dragFrom = i;
      thumb.classList.add("dragging");
      (e as DragEvent).dataTransfer!.effectAllowed = "move";
    });
    thumb.addEventListener("dragend", () => {
      thumb.classList.remove("dragging");
      document.querySelectorAll(".film-thumb").forEach((t) => t.classList.remove("dragover"));
    });
    thumb.addEventListener("dragover", (e) => {
      e.preventDefault();
      thumb.classList.add("dragover");
    });
    thumb.addEventListener("dragleave", () => thumb.classList.remove("dragover"));
    thumb.addEventListener("drop", (e) => {
      e.preventDefault();
      thumb.classList.remove("dragover");
      if (dragFrom != null) moveSlide(dragFrom, i);
      dragFrom = null;
    });
  });
}

/** Met à jour uniquement la vignette active (rapide, pour la frappe). */
function refreshActiveThumb() {
  const list = $("#film-list");
  const thumb = list.children[activeSlide] as HTMLElement | undefined;
  if (!thumb) return;
  const canvas = thumb.querySelector(".canvas") as HTMLElement;
  canvas.style.background = backgroundCss();
  layoutInto(canvas.querySelector("div") as HTMLElement, 148, 93, slides[activeSlide].text);
}

async function exportAllSlides() {
  const status = $("#film-status");
  const btn = $("#film-export") as HTMLButtonElement;
  const list = slides.filter((s) => s.text.trim());
  if (!list.length) {
    status.textContent = "No phrases to export.";
    return;
  }
  btn.disabled = true;
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:#0e0e0e;z-index:2147483600;display:flex;flex-direction:column;gap:14px;align-items:center;justify-content:center;color:#8ace00;font:600 22px -apple-system,sans-serif;";
  const label = document.createElement("div");
  overlay.appendChild(label);
  document.body.appendChild(overlay);
  try {
    const W = 1080;
    const H = Math.round((1080 * BOX_H) / BOX_W);
    const zip = new JSZip();
    const pad = String(list.length).length;
    for (let i = 0; i < list.length; i++) {
      label.textContent = `Rendering ${i + 1}/${list.length}…`;
      const url = await renderFrame(list[i].text, W, H, false);
      zip.file(`${String(i + 1).padStart(pad, "0")}_${slug(list[i].text)}.png`, url.split(",")[1], {
        base64: true,
      });
    }
    label.textContent = "Compressing…";
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `brat-lyrics_${list.length}-phrases.zip`;
    a.click();
    URL.revokeObjectURL(a.href);
    status.textContent = `✓ ${list.length} images exported.`;
  } catch (e) {
    status.textContent = "Error: " + (e as Error).message;
  } finally {
    overlay.remove();
    btn.disabled = false;
  }
}

// ---------- Tabs ----------
function bindTabs() {
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const tab = (b as HTMLElement).dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((x) => x.classList.toggle("active", x === b));
      document.querySelectorAll(".panel").forEach((p) =>
        p.classList.toggle("active", (p as HTMLElement).dataset.panel === tab)
      );
      if (tab === "export") updateHint();
      if (tab === "sync") buildTokens();
    })
  );
}

// ---------- Initialization ----------
input.addEventListener("input", () => {
  currentText = input.value;
  if (slides[activeSlide]) slides[activeSlide].text = currentText;
  render();
  buildTokens(); // le texte a changé -> reconstruire les tokens de synchro
  refreshActiveThumb();
  saveSlides();
});
window.addEventListener("resize", render);
$("#btn-export").addEventListener("click", exportSequence);
$("#btn-preview-seq").addEventListener("click", previewSteps);
["#e-mode", "#e-unit"].forEach((id) =>
  $(id).addEventListener("change", () => updateHint())
);

// --- Video sync ---
$("#sync-audio-file").addEventListener("change", (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) audioEl.src = URL.createObjectURL(f);
});
$("#sync-granularity").addEventListener("change", () => {
  ($("#sync-unit-label")).textContent =
    ($("#sync-granularity") as HTMLSelectElement).value === "line" ? "line" : "word";
  buildTokens();
});
$("#btn-tap").addEventListener("click", tap);
$("#btn-tap-undo").addEventListener("click", undoTap);
$("#btn-tap-reset").addEventListener("click", resetTaps);
$("#btn-export-video").addEventListener("click", exportVideo);

// --- Filmstrip ---
$("#film-add").addEventListener("click", addSlide);
$("#film-export").addEventListener("click", exportAllSlides);

// Space = tap when Sync tab is active (outside text input)
window.addEventListener("keydown", (e) => {
  if (e.code !== "Space") return;
  if (document.activeElement === input) return;
  const syncActive = document.querySelector('.panel[data-panel="sync"]')?.classList.contains("active");
  if (!syncActive) return;
  e.preventDefault();
  tap();
});

bindTabs();
bindControls();
syncValueLabels();

// Startup: reload saved deck, otherwise example phrase
try {
  const saved = JSON.parse(localStorage.getItem(SLIDES_KEY) || "null");
  if (saved && Array.isArray(saved.slides) && saved.slides.length) {
    slides = saved.slides;
    activeSlide = Math.min(saved.activeSlide || 0, slides.length - 1);
  }
} catch {
  /* ignore */
}
if (!slides.length) slides = [{ text: "there is something about those lyrics" }];
selectSlide(activeSlide);

// textFit depends on font metrics: re-render once woff is loaded
if (document.fonts && document.fonts.ready) {
  const reflow = () => {
    render();
    renderFilm();
  };
  document.fonts.load("100px arial_narrowregular").then(reflow);
  document.fonts.ready.then(reflow);
}
