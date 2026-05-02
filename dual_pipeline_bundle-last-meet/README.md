# Dual pipeline report bundle

Study-ready panel export: two CSVs, codebook, images.

## Layout
- `codebook/` — `panel_codebook.csv`, `DATA_DICTIONARY.md`
- `csvs/` — `panel_auto.csv`, `panel_simple.csv`
- `images/` — PNG files named `{auto|simple}_p{passage_id}_c{chunk_id}_img{n}.png`

## Row keys
- One row per selected (winning) image per chunk
- Align on `passage_id`, `chunk_id`, `pipeline_type`

## Timing fields
- `Transition sentence` is the last sentence of the chunk transcript
- Numeric timing columns expose when the chunk starts, ends, and how long it lasts
- `*_mmss` columns are presentation-friendly versions of the second-based values

## Columns (56)
Passage_Name, passage_id, Transition sentence, chunk_start_seconds, chunk_end_seconds, chunk_duration_seconds, chunk_start_mmss, chunk_end_mmss, chunk_duration_mmss, chunk_id, prompt_id, prompt_text, image_index, URL, Final Image Index, ai_consistency, ai_clip_similarity, ai_ocr_keyword, ai_speaker_verification, ai_audio_image_match, ai_coherence, ai_signaling, ai_text_quality, ai_emotional_design, ai_total_weighted_score, system_clip_similarity, system_clip_similarity_score, system_brightness, system_contrast, system_sharpness, system_colorfulness, system_attractiveness, system_mean_saturation, system_saturation_contrast, system_hue_singularity, system_chromatic_salience, system_predicted_character_count, system_expected_character_count, system_count_alignment_score, system_expected_speaker_phrase, system_gender_similarity, system_gender_alignment_score, system_keyword_mode, system_detected_keyword, system_exact_letter_match_case_insensitive, system_keyword_missing_visual, system_spatial_mismatch, system_surface_content_mismatch, chunk_transcript, full_transcript, pipeline_type, job_id, session_id, name_en, missing_ai_eval_flag, missing_system_metrics_flag
