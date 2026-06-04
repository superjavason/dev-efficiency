import { usagePayloadSchema, type UsageRecord } from "@/types";

export class UploadError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = "UploadError";
  }
}

export interface ViewerInfo {
  id: string;
  email: string;
  name: string;
  role: "admin" | "member";
}

export async function validateToken(serverUrl: string, token: string): Promise<ViewerInfo> {
  let res: Response;
  try {
    res = await fetch(`${serverUrl}/api/v1/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (e) {
    throw new UploadError(`network error contacting ${serverUrl}: ${(e as Error).message}`);
  }
  if (res.status === 200) {
    return (await res.json()) as ViewerInfo;
  }
  throw new UploadError(`token validation failed: HTTP ${res.status}`, res.status);
}

export interface UploadOptions {
  batchSize?: number;
  maxRetries?: number;
  sleepMs?: (attempt: number) => number;
}

export interface UploadResult {
  inserted: number;
  updated: number;
  batches: number;
}

function defaultSleep(attempt: number): number {
  return 1000 * Math.pow(2, attempt - 1);
}

function shouldRetry(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function postBatch(
  serverUrl: string,
  token: string,
  records: UsageRecord[],
  maxRetries: number,
  sleepMs: (attempt: number) => number,
): Promise<{ inserted: number; updated: number }> {
  const body = JSON.stringify(usagePayloadSchema.parse({ records }));
  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  let lastErr: UploadError | null = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${serverUrl}/api/v1/usage`, { method: "POST", headers, body });
    } catch (e) {
      lastErr = new UploadError(`network error: ${(e as Error).message}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, sleepMs(attempt)));
        continue;
      }
      throw lastErr;
    }
    if (res.status === 200) {
      return (await res.clone().json()) as { inserted: number; updated: number };
    }
    if (shouldRetry(res.status) && attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, sleepMs(attempt)));
      continue;
    }
    throw new UploadError(`POST /api/v1/usage failed: HTTP ${res.status}`, res.status);
  }
  throw lastErr ?? new UploadError("upload failed after retries");
}

export async function uploadRecords(
  serverUrl: string,
  token: string,
  records: UsageRecord[],
  opts: UploadOptions = {},
): Promise<UploadResult> {
  const batchSize = opts.batchSize ?? 500;
  const maxRetries = opts.maxRetries ?? 3;
  const sleepMs = opts.sleepMs ?? defaultSleep;
  let inserted = 0;
  let updated = 0;
  let batches = 0;
  for (let i = 0; i < records.length; i += batchSize) {
    const slice = records.slice(i, i + batchSize);
    const r = await postBatch(serverUrl, token, slice, maxRetries, sleepMs);
    inserted += r.inserted;
    updated += r.updated;
    batches += 1;
  }
  return { inserted, updated, batches };
}
