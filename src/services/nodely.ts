import type { AlgorandIndexerTransaction, AlgorandAssetInfo } from '@/types'
import { db } from '@/db'

// ─── Nodely Indexer Client ──────────────────────────────────────────
const INDEXER_BASE_URL = 'https://mainnet-idx.4160.nodely.dev'
const DEFAULT_PAGE_SIZE = 1000
const MAX_RETRIES = 3
const BASE_DELAY_MS = 200

// ─── Rate Limiting ──────────────────────────────────────────────────
let lastRequestTime = 0
const MIN_REQUEST_INTERVAL_MS = 200 // Conservative 5 req/s for free tier
let requestQueue: Promise<any> = Promise.resolve()

async function rateLimitedFetch(url: string): Promise<Response> {
    // Add request to a serial queue to prevent concurrent race conditions
    const result = requestQueue.then(async () => {
        const now = Date.now()
        const elapsed = now - lastRequestTime
        if (elapsed < MIN_REQUEST_INTERVAL_MS) {
            await sleep(MIN_REQUEST_INTERVAL_MS - elapsed)
        }
        lastRequestTime = Date.now()
        return fetch(url)
    })

    // Update the queue pointer but don't block the caller from seeing their own result
    requestQueue = result.catch(() => { })
    return result
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Retry Logic ────────────────────────────────────────────────────
async function fetchWithRetry(url: string): Promise<Response> {
    let lastError: Error | undefined
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const response = await rateLimitedFetch(url)
            if (response.ok) return response

            // Do not retry on 404 Not Found
            if (response.status === 404) {
                return response
            }

            if (response.status === 429) {
                // Rate limited — backoff
                await sleep(BASE_DELAY_MS * Math.pow(2, attempt))
                continue
            }
            throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err))
            if (attempt < MAX_RETRIES - 1) {
                await sleep(BASE_DELAY_MS * Math.pow(2, attempt))
            }
        }
    }
    throw lastError ?? new Error('Failed after retries')
}

// ─── Types for API Response ─────────────────────────────────────────
interface TransactionsResponse {
    'current-round': number
    'next-token'?: string
    transactions: AlgorandIndexerTransaction[]
}

interface AssetResponse {
    asset: AlgorandAssetInfo
}

// ─── Progress Callback ──────────────────────────────────────────────
export interface FetchProgress {
    fetchedCount: number
    currentPage: number
    hasMore: boolean
}

export type ProgressCallback = (progress: FetchProgress) => void

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Fetch ALL transactions for an Algorand address, paginating automatically.
 * Optionally filter by time range (RFC 3339 format).
 */
export async function fetchAllTransactions(
    address: string,
    options?: {
        afterTime?: string  // RFC 3339, e.g. "2025-07-01T00:00:00Z"
        beforeTime?: string // RFC 3339
        onProgress?: ProgressCallback
    }
): Promise<AlgorandIndexerTransaction[]> {
    const allTxns: AlgorandIndexerTransaction[] = []
    let nextToken: string | undefined
    let page = 0

    while (true) {
        const params = new URLSearchParams({
            limit: DEFAULT_PAGE_SIZE.toString(),
        })
        if (options?.afterTime) params.set('after-time', options.afterTime)
        if (options?.beforeTime) params.set('before-time', options.beforeTime)
        if (nextToken) params.set('next', nextToken)

        const url = `${INDEXER_BASE_URL}/v2/accounts/${address}/transactions?${params}`
        const response = await fetchWithRetry(url)
        const data = (await response.json()) as TransactionsResponse

        allTxns.push(...data.transactions)
        page++

        options?.onProgress?.({
            fetchedCount: allTxns.length,
            currentPage: page,
            hasMore: !!data['next-token'],
        })

        nextToken = data['next-token']
        if (!nextToken || data.transactions.length === 0) break
    }

    return allTxns
}

// ─── Asset Info Cache ───────────────────────────────────────────────
export const assetInfoCache = new Map<number, AlgorandAssetInfo>()
const missingAssetsCache = new Set<number>()
const lookupsInProgress = new Map<number, Promise<AlgorandAssetInfo>>()

export async function fetchAssetInfo(assetId: number): Promise<AlgorandAssetInfo> {
    const cached = assetInfoCache.get(assetId)
    if (cached) return cached

    if (missingAssetsCache.has(assetId)) {
        throw new Error(`Asset ${assetId} not found (cached)`)
    }

    // Deduplicate concurrent requests
    const inflight = lookupsInProgress.get(assetId)
    if (inflight) return inflight

    const lookupPromise = (async () => {
        try {
            // Check persistent negative cache
            const isMissing = await db.missingAssets.get(assetId)
            if (isMissing) {
                missingAssetsCache.add(assetId)
                throw new Error(`Asset ${assetId} not found (persistent)`)
            }

            const url = `${INDEXER_BASE_URL}/v2/assets/${assetId}`
            const response = await fetchWithRetry(url)

            if (response.status === 404) {
                missingAssetsCache.add(assetId)
                await db.missingAssets.put({ id: assetId })
                throw new Error(`Asset ${assetId} not found`)
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: failed to fetch asset info`)
            }

            const data = (await response.json()) as AssetResponse
            assetInfoCache.set(assetId, data.asset)
            return data.asset
        } finally {
            lookupsInProgress.delete(assetId)
        }
    })()

    lookupsInProgress.set(assetId, lookupPromise)
    return lookupPromise
}

/**
 * Batch fetch asset info for multiple asset IDs.
 * Deduplicates and caches results.
 */
export async function fetchAssetInfoBatch(assetIds: number[]): Promise<Map<number, AlgorandAssetInfo>> {
    const uniqueIds = [...new Set(assetIds)]
    const results = new Map<number, AlgorandAssetInfo>()

    for (const id of uniqueIds) {
        try {
            const info = await fetchAssetInfo(id)
            results.set(id, info)
        } catch (err) {
            console.warn(`Failed to fetch asset info for ${id}:`, err)
        }
    }

    return results
}

/**
 * Get the display name for an asset.
 */
export function getAssetDisplayName(info: AlgorandAssetInfo): string {
    return info.params['unit-name'] || info.params.name || `ASA #${info.index}`
}

/**
 * Convert a microAlgo/micro-ASA amount to standard units.
 */
export function toStandardUnits(amount: number, decimals: number): number {
    return amount / Math.pow(10, decimals)
}
