#!/usr/bin/env python3
"""
Merge panel CSVs + passage.json into a small dashboard_data.js for static hosting.
Passage list and auto chunks come from panel_auto.csv; panel_simple.csv fills
simpleImage when passage_id matches. Re-run when bundle CSVs or passage list change.
"""
import csv
import json
import pathlib
import re
from typing import Optional, Tuple

ROOT = pathlib.Path(__file__).resolve().parent
BUNDLE = ROOT / "dual_pipeline_bundle" / "csvs"
PASSAGE_JSON = ROOT / "passage.json"
OUT = ROOT / "dashboard_data.js"


def load_passages() -> dict:
    with open(PASSAGE_JSON, encoding="utf-8") as f:
        return {int(p["id"]): p for p in json.load(f)}


def _row_image_rel(row: dict) -> str:
    rel = (ROOT / "dual_pipeline_bundle" / row["URL"]).as_posix()
    return rel.replace(ROOT.as_posix() + "/", "")


def _parse_optional_float(val) -> Optional[float]:
    s = (val or "").strip() if val is not None else ""
    if not s:
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _normalize_match_text(s: str) -> str:
    """Lowercase, strip speaker tags and punctuation for substring keyword search."""
    if not s:
        return ""
    s = (
        s.replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2018", "'")
        .replace("\u2019", "'")
    )
    s = s.lower()
    s = re.sub(r"speaker_\d+\s*:", " ", s, flags=re.I)
    s = re.sub(r'["""`]+', " ", s)
    s = re.sub(r"[^\w\s]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _infer_keyword_appearance_time(row: dict, chunk_id: int) -> str:
    """
    When CSV keyword_appearance_time is missing/unknown, derive early|mid|late from
    chunk_transcript + system_detected_keyword, with transition sentence → late bias.
    chunk_id 0 is always n/a (playback uses chunk start only).
    """
    if chunk_id < 1:
        return "n/a"

    transcript = row.get("chunk_transcript") or ""
    keyword = (row.get("system_detected_keyword") or "").strip()
    transition = (row.get("Transition sentence") or "").strip()

    nt = _normalize_match_text(transcript)
    nk = _normalize_match_text(keyword)
    ntr = _normalize_match_text(transition)

    if nk and ntr and nk in ntr:
        return "late"
    if nk and nt:
        idx = nt.find(nk)
        if idx >= 0:
            ratio = idx / max(len(nt), 1)
            if ratio < 1 / 3:
                return "early"
            if ratio < 2 / 3:
                return "mid"
            return "late"
    if ntr:
        return "late"
    return "mid"


def _resolve_keyword_appearance_time(row: dict, chunk_id: int) -> str:
    raw = (row.get("keyword_appearance_time") or "").strip().lower()
    if raw in ("early", "mid", "late", "n/a"):
        return raw
    return _infer_keyword_appearance_time(row, chunk_id)


def _keyword_and_transition_seconds(
    row: dict, chunk_start: float, chunk_end: float
) -> Tuple[float, float]:
    """
    Prefer panel_auto.keyword_timestamp_seconds for keyword_estimated_at and
    image_transition_at (clamped to the chunk window). If missing or invalid,
    use chunk_start for both.
    """
    kw_ts = _parse_optional_float(row.get("keyword_timestamp_seconds"))
    if kw_ts is None or not (chunk_end >= chunk_start):
        return chunk_start, chunk_start
    t = min(max(kw_ts, chunk_start), chunk_end)
    return t, t


def main() -> None:
    passages = load_passages()
    by_id: dict = {}

    # panel_auto defines which passages exist and all auto chunks; panel_simple
    # only fills simpleImage when the same passage_id is present.
    with open(BUNDLE / "panel_auto.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not (row.get("passage_id") or "").strip():
                continue
            pid = int(row["passage_id"])
            if pid not in by_id:
                by_id[pid] = {
                    "id": pid,
                    "name_en": (row.get("name_en") or "").strip() or f"Passage {pid}",
                    "audio": "",
                    "simpleImage": "",
                    "autoChunks": [],
                }
            else:
                ne = (row.get("name_en") or "").strip()
                if ne:
                    cur = (by_id[pid].get("name_en") or "").strip()
                    if not cur or cur == f"Passage {pid}":
                        by_id[pid]["name_en"] = ne
            rel = _row_image_rel(row)
            cid = int(row["chunk_id"])
            c_start = float(row["chunk_start_seconds"])
            c_end = float(row["chunk_end_seconds"])
            bucket = _resolve_keyword_appearance_time(row, cid)
            kw_at, img_trans = _keyword_and_transition_seconds(row, c_start, c_end)
            by_id[pid]["autoChunks"].append(
                {
                    "chunk_id": cid,
                    "start": c_start,
                    "end": c_end,
                    "image": rel,
                    "keyword_appearance_time": bucket,
                    "keyword_estimated_at": round(kw_at, 4),
                    "image_transition_at": round(img_trans, 4),
                }
            )

    with open(BUNDLE / "panel_simple.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if not (row.get("passage_id") or "").strip():
                continue
            pid = int(row["passage_id"])
            if pid not in by_id:
                continue
            by_id[pid]["simpleImage"] = _row_image_rel(row)
            ne = (row.get("name_en") or "").strip()
            if ne:
                cur = (by_id[pid].get("name_en") or "").strip()
                if not cur or cur == f"Passage {pid}":
                    by_id[pid]["name_en"] = ne

    out_list = []
    for pid in sorted(by_id.keys()):
        o = by_id[pid]
        p = passages.get(pid)
        if not p or not p.get("audio_cdn_url"):
            print(
                f"Warning: skip passage {pid} — not in passage.json or missing audio_cdn_url",
                flush=True,
            )
            continue
        o["audio"] = p["audio_cdn_url"]
        o["autoChunks"].sort(key=lambda c: c["chunk_id"])
        if not o["simpleImage"] and not o["autoChunks"]:
            print(
                f"Warning: skip passage {pid} — no simple image and no auto chunks in CSVs",
                flush=True,
            )
            continue
        out_list.append(o)

    # Paths relative to index.html
    for o in out_list:
        o["simpleImage"] = o["simpleImage"]
        for c in o["autoChunks"]:
            c["image"] = c["image"]

    text = (
        "/* Auto-generated by build_dashboard_data.py — do not edit. */\n"
        "const DASHBOARD_DATA = "
        + json.dumps({"passages": out_list}, ensure_ascii=False, indent=2)
        + ";\n"
    )
    OUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT} ({len(out_list)} passages)")


if __name__ == "__main__":
    main()
