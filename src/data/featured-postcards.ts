export const FEATURED_SESSION_IDS = [
  "fd790bb3-876d-4713-a58c-5f14f28a2774",
  "0cd6bcd4-b193-4e27-9068-5540fa14d4bd",
  "001514ad-09f6-48d5-a669-e534509d7275",
  "d45cf605-fa46-43dd-8129-c01043841274",
  "40a6898f-fffd-40c7-a76d-a19f84bf91e1",
  "283a8225-9611-4a29-9076-733e44e3fb9e",
] as const;

export function isFeaturedSessionId(value: string) {
  return FEATURED_SESSION_IDS.includes(value as (typeof FEATURED_SESSION_IDS)[number]);
}
