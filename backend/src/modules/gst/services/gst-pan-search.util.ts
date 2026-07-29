export type GstListingStatus = 'listed' | 'unlisted';

export interface PanSearchGstinRecord {
  gstin: string;
  stateCode: string;
  listingStatus: GstListingStatus;
  legalName: string | null;
  tradeName: string | null;
  status: string | null;
  taxpayerType: string | null;
}

export interface PanSearchStateGroup {
  stateCode: string;
  gstins: PanSearchGstinRecord[];
}

export interface PanSearchCompareResult {
  pan: string;
  mode: string;
  skippedStateCodes?: string[];
  summary: {
    primaryGstinCount: number;
    sandboxGstinCount: number;
    listedCount: number;
    unlistedCount: number;
    missingFromSandboxCount: number;
  };
  primaryGstins: string[];
  byState: PanSearchStateGroup[];
  unlistedGstins: PanSearchGstinRecord[];
  missingFromSandbox: string[];
  failedStates: Array<{ stateCode: string; error: string }>;
}

function normalizeGstin(raw: unknown): string | null {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase();
  return value || null;
}

function stateCodeFromGstin(gstin: string, fallback?: string): string {
  const fromGstin = gstin.slice(0, 2);
  if (/^\d{2}$/.test(fromGstin)) {
    return fromGstin;
  }
  const fb = String(fallback ?? '').trim();
  if (/^\d{1,2}$/.test(fb)) {
    return fb.padStart(2, '0');
  }
  return '00';
}

/**
 * Sandbox pan/search `data` is either:
 * - array of { gstin?, data: { gstin, lgnm, ... } }
 * - { error_code: 'NOGSTIN', message }
 */
export function extractGstinsFromSandboxPayload(
  payload: unknown,
  fallbackStateCode?: string,
): Array<Omit<PanSearchGstinRecord, 'listingStatus'>> {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  const root = payload as Record<string, any>;
  const data = root.data ?? root;

  if (data && typeof data === 'object' && !Array.isArray(data) && data.error_code) {
    return [];
  }

  const items: any[] = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
      ? data.data
      : data?.gstin || data?.data?.gstin
        ? [data]
        : [];

  const out: Array<Omit<PanSearchGstinRecord, 'listingStatus'>> = [];
  const seen = new Set<string>();

  for (const item of items) {
    const nested =
      item?.data && typeof item.data === 'object' ? item.data : item;
    const gstin = normalizeGstin(nested?.gstin ?? item?.gstin);
    if (!gstin || seen.has(gstin)) {
      continue;
    }
    seen.add(gstin);
    out.push({
      gstin,
      stateCode: stateCodeFromGstin(gstin, fallbackStateCode),
      legalName: nested?.lgnm != null ? String(nested.lgnm) : null,
      tradeName: nested?.tradeNam != null ? String(nested.tradeNam) : null,
      status: nested?.sts != null ? String(nested.sts) : null,
      taxpayerType: nested?.dty != null ? String(nested.dty) : null,
    });
  }

  return out;
}

function collectFromSearchResponse(searchResponse: Record<string, any>): {
  mode: string;
  skippedStateCodes?: string[];
  records: Array<Omit<PanSearchGstinRecord, 'listingStatus'>>;
  failedStates: Array<{ stateCode: string; error: string }>;
} {
  const mode = String(searchResponse.mode ?? 'unknown');
  const failedStates: Array<{ stateCode: string; error: string }> = [];
  const records: Array<Omit<PanSearchGstinRecord, 'listingStatus'>> = [];

  if (mode === 'single-state') {
    const stateCode = String(searchResponse.stateCode ?? '');
    records.push(
      ...extractGstinsFromSandboxPayload(searchResponse.data, stateCode),
    );
    return {
      mode,
      records,
      failedStates,
    };
  }

  const results = Array.isArray(searchResponse.results)
    ? searchResponse.results
    : [];

  for (const result of results) {
    const stateCode = String(result?.stateCode ?? '');
    if (!result?.success) {
      failedStates.push({
        stateCode,
        error: String(result?.error ?? 'Unknown error'),
      });
      continue;
    }
    records.push(...extractGstinsFromSandboxPayload(result.data, stateCode));
  }

  return {
    mode,
    skippedStateCodes: Array.isArray(searchResponse.skippedStateCodes)
      ? searchResponse.skippedStateCodes.map(String)
      : undefined,
    records,
    failedStates,
  };
}

/**
 * Groups Sandbox PAN-search GSTINs by state and tags each as listed/unlisted
 * against primary GSTINs from gst_uploaded_file_data.
 */
export function comparePanSearchWithPrimaryGstins(
  searchResponse: Record<string, any>,
  primaryGstinsRaw: string[],
): PanSearchCompareResult {
  const pan = String(searchResponse.pan ?? '')
    .trim()
    .toUpperCase();
  const primaryGstins = [
    ...new Set(
      primaryGstinsRaw
        .map((g) => normalizeGstin(g))
        .filter((g): g is string => !!g),
    ),
  ].sort();
  const primarySet = new Set(primaryGstins);

  const collected = collectFromSearchResponse(searchResponse);
  const tagged: PanSearchGstinRecord[] = collected.records.map((r) => ({
    ...r,
    listingStatus: primarySet.has(r.gstin) ? 'listed' : 'unlisted',
  }));

  const byStateMap = new Map<string, PanSearchGstinRecord[]>();
  for (const record of tagged) {
    const list = byStateMap.get(record.stateCode) ?? [];
    list.push(record);
    byStateMap.set(record.stateCode, list);
  }

  const byState: PanSearchStateGroup[] = [...byStateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([stateCode, gstins]) => ({
      stateCode,
      gstins: gstins.sort((a, b) => a.gstin.localeCompare(b.gstin)),
    }));

  const sandboxSet = new Set(tagged.map((r) => r.gstin));
  const unlistedGstins = tagged
    .filter((r) => r.listingStatus === 'unlisted')
    .sort((a, b) => a.gstin.localeCompare(b.gstin));
  const missingFromSandbox = primaryGstins.filter((g) => !sandboxSet.has(g));

  return {
    pan,
    mode: collected.mode,
    skippedStateCodes: collected.skippedStateCodes,
    summary: {
      primaryGstinCount: primaryGstins.length,
      sandboxGstinCount: tagged.length,
      listedCount: tagged.filter((r) => r.listingStatus === 'listed').length,
      unlistedCount: unlistedGstins.length,
      missingFromSandboxCount: missingFromSandbox.length,
    },
    primaryGstins,
    byState,
    unlistedGstins,
    missingFromSandbox,
    failedStates: collected.failedStates,
  };
}
