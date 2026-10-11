export interface Meta { logo: string; logoSize: number; attacks: string[]; tampers: string[]; maxPayloadBytes: number; samples: string[]; hasResults: boolean }
export interface ProtectRes { original: string; protected: string; diff: string; psnr: number; ssim: number; payloadBytes: number; embedMs: number }
export interface AnalyzeRes {
  attacked: string; logo: string; nc: number; ber: number; payload: string | null; payloadIsText: boolean; payloadBytes: number;
  tamper: { w: number; h: number; bits: string }; flaggedBlocks: number; flaggedFraction: number; psnrVsInput: number; extractMs: number;
}
export interface Stat { mean: number; std: number }
export interface Results {
  meta: { dataset: string; images: string[]; hybrid_delta: number; calibration_target_psnr: number; calibrated_delta: { DCT: number; DWT2: number }; payload_bytes_main: number; tamper_placements_per_image: number; node: string; logo: string };
  capacity: Record<string, number>;
  E1_imperceptibility: Record<string, { psnr: Stat; ssim: Stat }>;
  E2_robustness: {
    watermark: Record<string, Record<string, { nc: Stat; ber: Stat }>>;
    hybrid_other_layers: Record<string, { payload_recovered_rate: number; tamper_flag_fraction: Stat }>;
    logos_image0: Record<string, Record<string, string>>;
  };
  E3_tamper: {
    per_type: Record<string, { precision: Stat; recall: Stat; f1: Stat; trials: number; pooled: { tp: number; fp: number; fn: number } }>;
    ablation_image_id: Record<string, { without_image_id: { recall: Stat }; with_image_id: { recall: Stat } }>;
    examples_image0: Record<string, { asset: string; flagged: string; truth: string }>;
    false_alarm_rate_untouched: { mean_flagged_block_fraction: number; images: number; blocks_per_image: number };
    tag_collision_probability_per_tampered_block: number;
  };
  E4_payload_sweep: { max_payload_bytes: number; rows: { payload_bytes: number; bpp: number; psnr: Stat; ssim: Stat; exact_recovery_rate: number | null }[] };
  E5_steganalysis_wrongkey: {
    chi_square: Record<string, { p_mean: number; p_median: number }>;
    wrong_key: Record<string, Stat>;
  };
  E6_runtime: Record<string, unknown> & { pbkdf2_100k_seconds: number };
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? `request failed (${r.status})`);
  return j as T;
}
const post = <T,>(path: string, body: unknown) => req<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  meta: () => req<Meta>("/api/meta"),
  results: () => req<Results>("/api/results"),
  protect: (b: { image?: string; sample?: string; key: string; imageId: string; payload: string }) => post<ProtectRes>("/api/protect", b),
  analyze: (b: { image: string; key: string; imageId: string; attack: string; seed: number }) => post<AnalyzeRes>("/api/analyze", b),
};
