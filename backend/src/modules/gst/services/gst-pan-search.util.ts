export interface EntityPanSearchBlock {
  pan: string;
  companyName: string | null;
  listedGstins: string[];
  unlistedGstins: string[];
}

export interface LoanPanSearchResult {
  loanId: string;
  customerId: string;
  primary: EntityPanSearchBlock | null;
  consideredEntities: EntityPanSearchBlock[];
}

export interface UploadLoanContext {
  loanId: string;
  customerId: string;
  primaryPan: string | null;
  primaryGstins: string[];
  /** Distinct considered-entity PANs with their uploaded GSTINs. */
  consideredEntities: Array<{
    pan: string;
    gstins: string[];
  }>;
}

function normalizePan(raw: unknown): string | null {
  const value = String(raw ?? '')
    .trim()
    .toUpperCase();
  return value || null;
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

interface SandboxGstinHit {
  gstin: string;
  stateCode: string;
  legalName: string | null;
  tradeName: string | null;
}

/**
 * Sandbox pan/search `data` is either:
 * - array of { gstin?, data: { gstin, lgnm, ... } }
 * - { error_code: 'NOGSTIN', message }
 */
export function extractGstinsFromSandboxPayload(
  payload: unknown,
  fallbackStateCode?: string,
): SandboxGstinHit[] {
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

  const out: SandboxGstinHit[] = [];
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
    });
  }

  return out;
}

export function collectSandboxGstins(
  searchResponse: Record<string, any>,
): SandboxGstinHit[] {
  const mode = String(searchResponse.mode ?? 'unknown');
  const records: SandboxGstinHit[] = [];
  const seen = new Set<string>();

  const pushAll = (hits: SandboxGstinHit[]) => {
    for (const hit of hits) {
      if (seen.has(hit.gstin)) continue;
      seen.add(hit.gstin);
      records.push(hit);
    }
  };

  if (mode === 'single-state') {
    pushAll(
      extractGstinsFromSandboxPayload(
        searchResponse.data,
        String(searchResponse.stateCode ?? ''),
      ),
    );
    return records;
  }

  const results = Array.isArray(searchResponse.results)
    ? searchResponse.results
    : [];
  for (const result of results) {
    if (!result?.success) continue;
    pushAll(
      extractGstinsFromSandboxPayload(
        result.data,
        String(result?.stateCode ?? ''),
      ),
    );
  }

  return records;
}

function pickCompanyName(hits: SandboxGstinHit[]): string | null {
  for (const hit of hits) {
    const name = (hit.legalName ?? hit.tradeName ?? '').trim();
    if (name) return name;
  }
  return null;
}

/**
 * Split Sandbox GSTINs into listed (present in upload) vs unlisted.
 */
export function buildEntityPanBlock(
  pan: string,
  sandboxHits: SandboxGstinHit[],
  uploadedGstins: string[],
): EntityPanSearchBlock {
  const uploadedSet = new Set(
    uploadedGstins
      .map((g) => normalizeGstin(g))
      .filter((g): g is string => !!g),
  );
  const listedGstins: string[] = [];
  const unlistedGstins: string[] = [];

  for (const hit of sandboxHits) {
    if (uploadedSet.has(hit.gstin)) {
      listedGstins.push(hit.gstin);
    } else {
      unlistedGstins.push(hit.gstin);
    }
  }

  listedGstins.sort();
  unlistedGstins.sort();

  return {
    pan: normalizePan(pan) ?? pan,
    companyName: pickCompanyName(sandboxHits),
    listedGstins,
    unlistedGstins,
  };
}

export function buildLoanPanSearchResult(
  context: UploadLoanContext,
  primarySandbox: Record<string, any> | null,
  consideredSandboxByPan: Map<string, Record<string, any>>,
): LoanPanSearchResult {
  const primary =
    context.primaryPan && primarySandbox
      ? buildEntityPanBlock(
          context.primaryPan,
          collectSandboxGstins(primarySandbox),
          context.primaryGstins,
        )
      : context.primaryPan
        ? {
            pan: context.primaryPan,
            companyName: null,
            listedGstins: [],
            unlistedGstins: [],
          }
        : null;

  const consideredEntities = context.consideredEntities.map((entity) => {
    const sandbox = consideredSandboxByPan.get(entity.pan) ?? null;
    return buildEntityPanBlock(
      entity.pan,
      sandbox ? collectSandboxGstins(sandbox) : [],
      entity.gstins,
    );
  });

  return {
    loanId: context.loanId,
    customerId: context.customerId,
    primary,
    consideredEntities,
  };
}
