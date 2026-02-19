// ─── Known Mainnet Application IDs ──────────────────────────────────
// These are used to classify DeFi transactions by protocol

export const KNOWN_APPS: Record<string, number> = {
    // Tinyman V2
    tinyman_v2_amm: 1002541853,

    // Pact
    pact_amm: 1005765278,

    // Folks Finance
    folks_pool_manager: 971350278,
    folks_deposit: 971353536,
    folks_galgo_pool: 971370097,
    folks_staking: 1093729103,
    folks_algo_pool: 971368268,
    folks_usdc_pool: 971372237,
    folks_loan: 971388781,
    folks_ecosystem_loan: 3184333108,
} as const

// Reverse lookup: app ID → protocol name
export const APP_ID_TO_PROTOCOL: Record<number, string> = Object.entries(KNOWN_APPS).reduce(
    (acc, [key, id]) => {
        const protocol = key.split('_')[0]!
        acc[id] = protocol
        return acc
    },
    {} as Record<number, string>
)

// Protocol groupings for UI
export type DeFiProtocol = 'tinyman' | 'pact' | 'folks' | 'governance' | 'unknown'

export function getProtocolForAppId(appId: number): DeFiProtocol {
    const protocol = APP_ID_TO_PROTOCOL[appId]
    if (protocol === 'tinyman') return 'tinyman'
    if (protocol === 'pact') return 'pact'
    if (protocol === 'folks') return 'folks'
    return 'unknown'
}

// ─── Known Asset IDs ────────────────────────────────────────────────
export const KNOWN_ASSETS: Record<string, number> = {
    USDC: 31566704,
    USDt: 312769,
    goBTC: 386192725,
    goETH: 386195940,
    TINY: 378382099,
    gALGO: 793124631,
    xALGO: 1134696561,
    tALGO: 2537013734,
    PACT: 1172789908,
} as const

// Asset ID → name for quick lookup
export const ASSET_ID_TO_NAME: Record<number, string> = Object.entries(KNOWN_ASSETS).reduce(
    (acc, [name, id]) => {
        acc[id] = name
        return acc
    },
    {} as Record<number, string>
)

// ─── Known Governance Addresses ─────────────────────────────────────
// Governance reward distribution addresses (these change per period)
export const GOVERNANCE_NOTE_PREFIXES = [
    'af/gov',     // Algorand Foundation governance
    'af/xgov',    // Expert governance
]

// ─── NFT Detection ──────────────────────────────────────────────────
export function isLikelyNFT(total: number, decimals: number): boolean {
    // NFTs typically have total supply of 1 and 0 decimals
    // Some NFT collections use small totals (< 100) with 0 decimals
    return decimals === 0 && total > 0 && total <= 100
}

// ─── Stablecoins ────────────────────────────────────────────────────
export const STABLECOIN_IDS = new Set([
    KNOWN_ASSETS.USDC,
    KNOWN_ASSETS.USDt,
])

export function isStablecoin(assetId: number): boolean {
    return STABLECOIN_IDS.has(assetId)
}

// ─── Liquid Staking Tokens ──────────────────────────────────────────
export const LIQUID_STAKING_IDS = new Set([
    KNOWN_ASSETS.gALGO,
    KNOWN_ASSETS.xALGO,
    KNOWN_ASSETS.tALGO,
])

export function isLiquidStakingToken(assetId: number): boolean {
    return LIQUID_STAKING_IDS.has(assetId)
}
