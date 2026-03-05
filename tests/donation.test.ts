import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
    buildAlgorandPaymentUri,
    calcMicroAlgosFromAud,
    clearDonationQuoteCache,
    fetchAlgoAudRate,
    getDonationQuote,
    resolveNfdRecipient,
} from '@/services/donation'

describe('donation service', () => {
    beforeEach(() => {
        clearDonationQuoteCache()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('converts A$5 to microAlgos using the current rate', () => {
        expect(calcMicroAlgosFromAud(5, 0.125)).toBe(40_000_000)
    })

    it('builds a payment uri with amount and encoded note', () => {
        const uri = buildAlgorandPaymentUri('SZS55FKNGERPTHGHPC3OP6EDVA5LCI5KOP7J2CKAYXGMCXBWV4TUPDLQIA', 40_000_000, 'Coffee for AlgoTax')
        expect(uri).toContain('algorand://SZS55FKNGERPTHGHPC3OP6EDVA5LCI5KOP7J2CKAYXGMCXBWV4TUPDLQIA')
        expect(uri).toContain('amount=40000000')
        expect(uri).toContain('xnote=Coffee+for+AlgoTax')
    })

    it('parses algoname recipient from NFD', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ owner: 'SZS55FKNGERPTHGHPC3OP6EDVA5LCI5KOP7J2CKAYXGMCXBWV4TUPDLQIA' }), { status: 200 })))

        const recipient = await resolveNfdRecipient('twirtle2.algo')
        expect(recipient).toBe('SZS55FKNGERPTHGHPC3OP6EDVA5LCI5KOP7J2CKAYXGMCXBWV4TUPDLQIA')
    })

    it('falls back to cached quote when live calls fail', async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(new Response(JSON.stringify({ owner: 'SZS55FKNGERPTHGHPC3OP6EDVA5LCI5KOP7J2CKAYXGMCXBWV4TUPDLQIA' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ algorand: { aud: 0.125 } }), { status: 200 }))
            .mockRejectedValueOnce(new Error('NFD down'))
            .mockRejectedValueOnce(new Error('CoinGecko down'))

        vi.stubGlobal('fetch', fetchMock)

        const fresh = await getDonationQuote()
        expect(fresh.isCached).toBeUndefined()

        const cached = await getDonationQuote()
        expect(cached.isCached).toBe(true)
    })

    it('fetches ALGO/AUD rate from expected payload', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ algorand: { aud: 0.1337 } }), { status: 200 })))

        await expect(fetchAlgoAudRate()).resolves.toBe(0.1337)
    })
})
