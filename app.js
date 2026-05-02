(function () {
  "use strict";

  const data = DASHBOARD_DATA.passages;
  const select = document.getElementById("passage-select");
  const player = document.getElementById("player");
  const imgSimple = document.getElementById("img-simple");
  const imgAuto = document.getElementById("img-auto");
  const btnPrev = document.getElementById("btn-prev");
  const btnNext = document.getElementById("btn-next");
  const playBtn = document.getElementById("play-btn");
  const seek = document.getElementById("seek");
  const volume = document.getElementById("volume");
  const timeReadout = document.getElementById("time-readout");
  const passageIndex = document.getElementById("passage-index");

  const VOLUME_KEY = "audio2image-dashboard-volume";

  /**
   * Dashboard emits root-relative paths (/dual_pipeline_bundle/...) for Render etc.
   * file:// opens must strip the leading slash so requests stay beside index.html.
   */
  function assetUrl(path) {
    if (!path) return "";
    if (/^https?:\/\//i.test(path)) return path;
    if (path.startsWith("/")) {
      if (window.location.protocol === "file:") {
        return path.slice(1);
      }
      return path;
    }
    return path;
  }

  let current = null;
  let lastAutoChunkId = -1;
  let seekDragging = false;

  function optionLabel(p) {
    return p.id + " — " + p.name_en;
  }

  /**
   * Time (seconds) at which the auto image switches *to* this chunk’s frame.
   * chunk_id 0: audio from t=0 up to the next cut still uses chunk 0.
   * chunk_id >= 1: prefer image_transition_at from build_dashboard_data.py —
   * panel_auto.keyword_timestamp_seconds (clamped) when set, else chunk start.
   * Legacy: keyword_appearance_time early|mid|late|n/a with fixed fractions.
   */
  function autoChunkImageCutInSeconds(ch) {
    var dur = ch.end - ch.start;
    if (ch.chunk_id < 1 || !isFinite(dur) || dur <= 0) {
      return ch.start;
    }
    var cut = ch.image_transition_at;
    if (cut != null && isFinite(Number(cut))) {
      return Number(cut);
    }
    var k = (ch.keyword_appearance_time || "").toLowerCase().trim();
    var kwFrac = 0;
    if (k === "mid") {
      kwFrac = 0.5;
    } else if (k === "late") {
      kwFrac = 0.75;
    }
    var kwAt = ch.start + kwFrac * dur;
    return (ch.start + kwAt) / 2;
  }

  function pickAutoChunk(chunks, t) {
    if (!chunks || chunks.length === 0) {
      return null;
    }
    if (chunks.length === 1) {
      return chunks[0];
    }
    var sorted = chunks.slice().sort(function (a, b) {
      return a.chunk_id - b.chunk_id;
    });
    var selected = 0;
    for (var i = 0; i < sorted.length; i++) {
      var cut = i === 0 ? 0 : autoChunkImageCutInSeconds(sorted[i]);
      if (t >= cut) {
        selected = i;
      }
    }
    return sorted[selected];
  }

  function getCurrentIndex() {
    if (current == null) return 0;
    return data.indexOf(current);
  }

  function formatTime(sec) {
    if (sec == null || !isFinite(sec) || sec < 0) {
      return "0:00";
    }
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function updateTimeReadout() {
    const cur = player.currentTime;
    const dur = player.duration;
    const dStr = dur && isFinite(dur) ? formatTime(dur) : "0:00";
    timeReadout.textContent = formatTime(cur) + " / " + dStr;
  }

  function cssVar(name, fallback) {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
    const v = (raw && raw.trim()) || "";
    return v || fallback;
  }

  function updateSeekStyle() {
    const fill = cssVar("--seek-fill", "#1e3a5f");
    const rail = cssVar("--seek-rail", "#b8b0a3");
    const d = player.duration;
    const t = seekDragging ? parseFloat(seek.value) : player.currentTime;
    if (!d || !isFinite(d) || d <= 0) {
      seek.style.background = rail;
      return;
    }
    const pct = Math.min(100, Math.max(0, (t / d) * 100));
    seek.style.background =
      "linear-gradient(to right, " +
      fill +
      " 0%, " +
      fill +
      " " +
      pct +
      "%, " +
      rail +
      " " +
      pct +
      "%, " +
      rail +
      " 100%)";
  }

  function updateVolumeStyle() {
    const fill = cssVar("--vol-fill", "#0d9488");
    const rail = cssVar("--vol-rail", "#b8b0a3");
    const pct = Math.min(100, Math.max(0, parseFloat(volume.value) || 0));
    volume.style.background =
      "linear-gradient(to right, " +
      fill +
      " 0%, " +
      fill +
      " " +
      pct +
      "%, " +
      rail +
      " " +
      pct +
      "%, " +
      rail +
      " 100%)";
  }

  function syncPlayButton() {
    if (player.paused) {
      playBtn.classList.remove("is-playing");
      playBtn.setAttribute("aria-label", "Play");
    } else {
      playBtn.classList.add("is-playing");
      playBtn.setAttribute("aria-label", "Pause");
    }
  }

  function onPlayerTime() {
    if (!seekDragging) {
      if (player.duration && isFinite(player.duration)) {
        seek.value = String(player.currentTime);
      }
      updateSeekStyle();
    }
    updateTimeReadout();
    syncAutoImage(player.currentTime);
  }

  function updateNavUi() {
    const i = getCurrentIndex();
    btnPrev.disabled = i <= 0;
    btnNext.disabled = i >= data.length - 1;
    passageIndex.textContent = i + 1 + " / " + data.length;
  }

  function applyPassage(p) {
    current = p;
    lastAutoChunkId = -1;
    seekDragging = false;
    player.src = p.audio;
    playBtn.classList.remove("is-playing");
    playBtn.setAttribute("aria-label", "Play");
    player.load();
    seek.value = "0";
    seek.max = "0";
    updateSeekStyle();
    updateTimeReadout();
    if (p.simpleImage) {
      imgSimple.src = assetUrl(p.simpleImage);
    } else {
      imgSimple.removeAttribute("src");
    }
    imgSimple.alt = p.simpleImage
      ? "Simple pipeline: " + optionLabel(p)
      : "No simple pipeline image in bundle for this passage.";
    syncAutoImage(0);
    updateNavUi();
  }

  function setPassageByIndex(i) {
    if (i < 0 || i >= data.length) return;
    const p = data[i];
    select.value = String(p.id);
    applyPassage(p);
  }

  function syncAutoImage(t) {
    if (!current) return;
    if (!current.autoChunks || current.autoChunks.length === 0) {
      lastAutoChunkId = -1;
      imgAuto.removeAttribute("src");
      imgAuto.alt = "No auto pipeline images in bundle for this passage.";
      return;
    }
    const ch = pickAutoChunk(current.autoChunks, t);
    if (ch == null) return;
    if (ch.chunk_id === lastAutoChunkId) return;
    lastAutoChunkId = ch.chunk_id;
    imgAuto.src = assetUrl(ch.image);
    imgAuto.alt = "Auto pipeline: " + optionLabel(current) + " (chunk " + ch.chunk_id + ")";
  }

  function togglePlay() {
    if (player.paused) {
      const playPromise = player.play();
      if (playPromise && playPromise.catch) {
        playPromise.catch(function () {});
      }
    } else {
      player.pause();
    }
  }

  for (const p of data) {
    const opt = document.createElement("option");
    opt.value = String(p.id);
    opt.textContent = optionLabel(p);
    select.appendChild(opt);
  }

  select.addEventListener("change", function () {
    const id = parseInt(select.value, 10);
    const p = data.find(function (x) {
      return x.id === id;
    });
    if (p) applyPassage(p);
  });

  btnPrev.addEventListener("click", function () {
    setPassageByIndex(getCurrentIndex() - 1);
  });

  btnNext.addEventListener("click", function () {
    setPassageByIndex(getCurrentIndex() + 1);
  });

  playBtn.addEventListener("click", function () {
    togglePlay();
  });

  seek.addEventListener("pointerdown", function () {
    seekDragging = true;
  });
  window.addEventListener("pointerup", function () {
    if (seekDragging) {
      seekDragging = false;
      updateSeekStyle();
    }
  });
  seek.addEventListener("input", function () {
    const d = player.duration;
    if (!d || !isFinite(d)) return;
    const v = parseFloat(seek.value);
    player.currentTime = v;
    updateTimeReadout();
    updateSeekStyle();
    syncAutoImage(v);
  });

  volume.addEventListener("input", function () {
    const v = Math.min(1, Math.max(0, parseFloat(volume.value) / 100));
    player.volume = v;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume.value));
    } catch (e) {}
    updateVolumeStyle();
  });

  player.addEventListener("timeupdate", onPlayerTime);
  player.addEventListener("loadedmetadata", function () {
    const d = player.duration;
    if (d && isFinite(d) && d > 0) {
      seek.max = d;
      seek.setAttribute("aria-valuemax", d);
    }
    seek.value = String(player.currentTime);
    updateSeekStyle();
    updateTimeReadout();
  });

  player.addEventListener("play", syncPlayButton);
  player.addEventListener("pause", syncPlayButton);
  player.addEventListener("ended", syncPlayButton);

  function formFieldOrButton(el) {
    if (!el || !el.tagName) return false;
    const t = el.tagName;
    if (t === "TEXTAREA" || t === "SELECT" || t === "BUTTON") return true;
    if (t === "INPUT") {
      const type = (el.type || "").toLowerCase();
      return type !== "button" && type !== "reset" && type !== "submit";
    }
    return el.isContentEditable;
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === " " || e.key === "Spacebar" || e.code === "Space") {
      if (formFieldOrButton(e.target)) return;
      e.preventDefault();
      togglePlay();
      return;
    }
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "SELECT")) return;
    if (e.key === "ArrowLeft" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!btnPrev.disabled) setPassageByIndex(getCurrentIndex() - 1);
    } else if (e.key === "ArrowRight" && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      if (!btnNext.disabled) setPassageByIndex(getCurrentIndex() + 1);
    }
  });

  (function initVolume() {
    let stored = 100;
    try {
      const raw = localStorage.getItem(VOLUME_KEY);
      if (raw != null) {
        const n = parseInt(raw, 10);
        if (isFinite(n) && n >= 0 && n <= 100) stored = n;
      }
    } catch (e) {}
    volume.value = String(stored);
    player.volume = stored / 100;
    updateVolumeStyle();
  })();

  if (!data || data.length === 0) {
    const emptyEl = document.getElementById("dashboard-empty");
    if (emptyEl) emptyEl.removeAttribute("hidden");
    select.disabled = true;
    seek.disabled = true;
    volume.disabled = true;
    playBtn.disabled = true;
    btnPrev.disabled = true;
    btnNext.disabled = true;
    passageIndex.textContent = "—";
    return;
  }

  setPassageByIndex(0);
  select.value = String(data[0].id);
})();
