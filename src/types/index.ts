// ─── Transaction Classification ─────────────────────────────────────
export type TxClassification =
    | 'buy'
    | 'sell'
    | 'swap'
    | 'transfer_in'
    | 'transfer_out'
    | 'staking_reward'
    | 'governance_reward'
    | 'lp_add'
    | 'lp_remove'
    | 'airdrop'
    | 'nft_purchase'
    | 'nft_sale'
    | 'nft_mint'
    | 'opt_in'
    | 'app_call'
    | 'fee'
    | 'income_other'
    | 'unknown'

export type TxSource = 'algorand'
export type AssetIdentifier = number | 'ALGO'
export type CostBasisMethod = 'FIFO' | 'LIFO'
export type Region = 'AU' | 'US' | 'GB' | 'CA' | 'EU'
export type SupportedCurrency = 'AUD' | 'USD' | 'GBP' | 'CAD' | 'EUR'


// ─── Unified Transaction ─────────────────────────────────────────────
export interface UnifiedTransaction {
    id: string
    source: TxSource
    timestamp: number // Unix seconds
    classification: TxClassification
    fromAddress?: string
    toAddress?: string
    assetId: AssetIdentifier
    assetName: string
    amount: number // Standard units (not microAlgos)
    feeAlgo: number
    audValueAtTime?: number
    txHash: string
    groupId?: string
    innerTxns?: UnifiedTransaction[]
    rawData: unknown
    notes?: string
    manualClassification?: TxClassification
}

// ─── Wallet Config ──────────────────────────────────────────────────
export interface WalletConfig {
    address: string
    label: string
    addedAt: number
}

// ─── App Settings ───────────────────────────────────────────────────
export interface AppSettings {
    financialYear: string // e.g. "2025-26"
    region: Region
    wallets: WalletConfig[]
}


export interface KoinlyExportOptions {
    dustThreshold: number // in ALGO
    excludeNFTs: boolean
    excludeOwnTransfers: boolean
    excludeOptIns: boolean
    excludeZeroAmount: boolean
    excludeASAs: boolean
    whitelistedAssetIds: (number | 'ALGO')[]
    exportAllHistory: boolean
}


// ─── Algorand Indexer Types (subset) ────────────────────────────────
export type AlgorandTxType = 'pay' | 'axfer' | 'appl' | 'acfg' | 'afrz' | 'keyreg'

export interface AlgorandIndexerTransaction {
    id: string
    'tx-type': AlgorandTxType
    sender: string
    fee: number
    'first-valid': number
    'last-valid': number
    'confirmed-round': number
    'round-time': number
    'intra-round-offset': number
    group?: string
    note?: string
    'genesis-id': string
    'payment-transaction'?: {
        amount: number
        receiver: string
        'close-amount'?: number
        'close-remainder-to'?: string
    }
    'asset-transfer-transaction'?: {
        'asset-id': number
        amount: number
        receiver: string
        sender?: string // clawback
        'close-amount'?: number
        'close-to'?: string
    }
    'application-transaction'?: {
        'application-id': number
        'on-completion': string
        'application-args'?: string[]
        accounts?: string[]
        'foreign-apps'?: number[]
        'foreign-assets'?: number[]
    }
    'asset-config-transaction'?: {
        'asset-id'?: number
        params?: {
            total?: number
            decimals?: number
            'unit-name'?: string
            name?: string
            url?: string
            creator?: string
        }
    }
    'inner-txns'?: AlgorandIndexerTransaction[]
    'created-asset-index'?: number
}

export interface AlgorandAssetInfo {
    index: number
    params: {
        total: number
        decimals: number
        'unit-name'?: string
        name?: string
        url?: string
        creator: string
        'default-frozen'?: boolean
    }
}

