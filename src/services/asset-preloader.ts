import { fetchAssetInfo } from './nodely'

const INDEXER_BASE_URL = 'https://mainnet-idx.4160.nodely.dev'

interface AccountAssetsResponse {
    assets: Array<{
        'asset-id': number
        amount: number
    }>
}

/**
 * Pre-fetch name and decimals for all assets currently held by an account.
 * This is much more efficient than fetching them one-by-one during classification.
 */
export async function preloadAccountAssets(address: string): Promise<void> {
    try {
        const url = `${INDEXER_BASE_URL}/v2/accounts/${address}/assets`
        const response = await fetch(url)
        if (!response.ok) return

        const data = (await response.json()) as AccountAssetsResponse
        const assetIds = data.assets.map((a) => a['asset-id'])

        // Fetch details for all assets in parallel (requestQueue in nodely will throttle)
        await Promise.allSettled(assetIds.map(id => fetchAssetInfo(id)))

    } catch (err) {
        console.warn(`Failed to preload assets for ${address}:`, err)
    }
}
