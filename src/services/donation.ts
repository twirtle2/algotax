const NFD_BASE_URL = 'https://api.nf.domains/nfd'
const COINGECKO_SIMPLE_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=algorand&vs_currencies=aud'
const MICRO_ALGOS_PER_ALGO = 1_000_000
const DONATION_CACHE_TTL_MS = 5 * 60 * 1000

export const DEFAULT_NFD_NAME = 'twirtle2.algo'
export const DEFAULT_DONATION_AUD = 5
export const DEFAULT_DONATION_NOTE = 'Coffee for AlgoTax'

interface NfdTinyResponse {
    owner?: string
    depositAccount?: string
}

interface CoinGeckoPriceResponse {
    algorand?: {
        aud?: number
    }
}

export interface DonationQuote {
    recipientName: string
    recipientAddress: string
    audAmount: number
    algoAudRate: number
    algoAmount: number
    microAlgos: number
    note: string
    algorandUri: string
    peraUri: string
    generatedAt: number
    isCached?: boolean
}

interface DonationCacheEntry {
    quote: DonationQuote
    savedAt: number
}

let donationQuoteCache: DonationCacheEntry | null = null

function isAlgorandAddress(value: string): boolean {
    return /^[A-Z2-7]{58}$/.test(value)
}

// Pera deeplink handling may treat '+' as spaces more reliably than '%20'.
function encodeNoteForWallet(note: string): string {
    return encodeURIComponent(note).replace(/%20/g, '+')
}

export function calcMicroAlgosFromAud(audAmount: number, algoAudRate: number): number {
    if (!Number.isFinite(audAmount) || audAmount <= 0) {
        throw new Error('AUD amount must be a positive number')
    }
    if (!Number.isFinite(algoAudRate) || algoAudRate <= 0) {
        throw new Error('ALGO/AUD rate must be a positive number')
    }

    return Math.max(1, Math.round((audAmount / algoAudRate) * MICRO_ALGOS_PER_ALGO))
}

export function buildAlgorandPaymentUri(address: string, microAlgos: number, note: string): string {
    const query = `amount=${microAlgos}&xnote=${encodeNoteForWallet(note)}`

    return `algorand://${address}?${query}`
}

export function buildPeraPaymentUri(address: string, microAlgos: number, note: string): string {
    const query = `amount=${microAlgos}&xnote=${encodeNoteForWallet(note)}`

    return `perawallet://${address}?${query}`
}

export async function fetchAlgoAudRate(): Promise<number> {
    const response = await fetch(COINGECKO_SIMPLE_PRICE_URL)
    if (!response.ok) {
        throw new Error(`Failed to fetch ALGO/AUD rate (${response.status})`)
    }

    const data = (await response.json()) as CoinGeckoPriceResponse
    const rate = data.algorand?.aud
    if (!rate || rate <= 0) {
        throw new Error('Invalid ALGO/AUD rate response')
    }

    return rate
}

export async function resolveNfdRecipient(name: string): Promise<string> {
    const encodedName = encodeURIComponent(name)
    const response = await fetch(`${NFD_BASE_URL}/${encodedName}?view=tiny`)
    if (!response.ok) {
        throw new Error(`Failed to resolve ${name} (${response.status})`)
    }

    const data = (await response.json()) as NfdTinyResponse
    const recipientAddress = data.depositAccount ?? data.owner

    if (!recipientAddress || !isAlgorandAddress(recipientAddress)) {
        throw new Error(`Invalid recipient address for ${name}`)
    }

    return recipientAddress
}

function hasFreshCache(cache: DonationCacheEntry | null): cache is DonationCacheEntry {
    return !!cache && Date.now() - cache.savedAt <= DONATION_CACHE_TTL_MS
}

export async function getDonationQuote(): Promise<DonationQuote> {
    try {
        const [recipientAddress, algoAudRate] = await Promise.all([
            resolveNfdRecipient(DEFAULT_NFD_NAME),
            fetchAlgoAudRate(),
        ])

        const microAlgos = calcMicroAlgosFromAud(DEFAULT_DONATION_AUD, algoAudRate)
        const algoAmount = microAlgos / MICRO_ALGOS_PER_ALGO

        const quote: DonationQuote = {
            recipientName: DEFAULT_NFD_NAME,
            recipientAddress,
            audAmount: DEFAULT_DONATION_AUD,
            algoAudRate,
            algoAmount,
            microAlgos,
            note: DEFAULT_DONATION_NOTE,
            algorandUri: buildAlgorandPaymentUri(recipientAddress, microAlgos, DEFAULT_DONATION_NOTE),
            peraUri: buildPeraPaymentUri(recipientAddress, microAlgos, DEFAULT_DONATION_NOTE),
            generatedAt: Date.now(),
        }

        donationQuoteCache = { quote, savedAt: Date.now() }
        return quote
    } catch (error) {
        if (hasFreshCache(donationQuoteCache)) {
            return {
                ...donationQuoteCache.quote,
                generatedAt: Date.now(),
                isCached: true,
            }
        }

        if (error instanceof Error) {
            throw error
        }

        throw new Error('Unable to prepare donation quote')
    }
}

export function clearDonationQuoteCache(): void {
    donationQuoteCache = null
}
