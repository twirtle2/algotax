import { useCallback, useEffect, useMemo, useState } from 'react'
import * as QRCode from 'qrcode'
import { DEFAULT_DONATION_AUD, getDonationQuote, type DonationQuote } from '@/services/donation'

interface DonationModalProps {
    open: boolean
    onClose: () => void
}

type DonationModalState = 'idle' | 'loading' | 'ready' | 'error'

export default function DonationModal({ open, onClose }: DonationModalProps) {
    const [state, setState] = useState<DonationModalState>('idle')
    const [quote, setQuote] = useState<DonationQuote | null>(null)
    const [qrDataUrl, setQrDataUrl] = useState<string>('')
    const [errorMessage, setErrorMessage] = useState<string>('')
    const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
    const [audAmountInput, setAudAmountInput] = useState<string>(String(DEFAULT_DONATION_AUD))

    const parsedAudAmount = useMemo(() => {
        const value = Number(audAmountInput)
        if (!Number.isFinite(value) || value <= 0) {
            return null
        }
        return value
    }, [audAmountInput])

    const loadQuote = useCallback(async (audAmount: number) => {
        setState('loading')
        setErrorMessage('')
        setCopyState('idle')

        try {
            const nextQuote = await getDonationQuote(audAmount)
            const qrUrl = await QRCode.toDataURL(nextQuote.algorandUri, {
                width: 320,
                margin: 2,
                color: {
                    dark: '#111822',
                    light: '#ffffff',
                },
            })

            setQuote(nextQuote)
            setQrDataUrl(qrUrl)
            setState('ready')
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unable to prepare donation payment QR code.'
            setErrorMessage(message)
            setState('error')
        }
    }, [])

    useEffect(() => {
        if (!open) return
        setAudAmountInput(String(DEFAULT_DONATION_AUD))
        void loadQuote(DEFAULT_DONATION_AUD)
    }, [open, loadQuote])

    useEffect(() => {
        if (!open) return

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [open])

    useEffect(() => {
        if (!open) return

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose()
            }
        }

        window.addEventListener('keydown', handleEscape)
        return () => window.removeEventListener('keydown', handleEscape)
    }, [open, onClose])

    const handleCopy = useCallback(async () => {
        if (!quote) return

        try {
            await navigator.clipboard.writeText(quote.algorandUri)
            setCopyState('copied')
        } catch {
            setCopyState('failed')
        }
    }, [quote])

    const algoAmountText = useMemo(() => {
        if (!quote) return ''
        return quote.algoAmount.toFixed(6)
    }, [quote])

    const exchangeRateText = useMemo(() => {
        if (!quote) return ''
        return quote.algoAudRate.toFixed(6)
    }, [quote])

    if (!open) return null

    return (
        <div
            className="coffee-modal-overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose()
                }
            }}
        >
            <section
                className="coffee-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="coffee-modal-title"
            >
                <header className="coffee-modal-header">
                    <div>
                        <h3 id="coffee-modal-title">Buy me a coffee</h3>
                        <p>Scan in Pera Wallet to send A${quote?.audAmount.toFixed(2) ?? DEFAULT_DONATION_AUD.toFixed(2)} in ALGO.</p>
                    </div>
                    <button
                        type="button"
                        className="coffee-modal-close"
                        onClick={onClose}
                        aria-label="Close donation dialog"
                    >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6l-12 12" />
                        </svg>
                    </button>
                </header>

                {state === 'loading' && (
                    <div className="coffee-modal-loading" aria-live="polite">
                        <div className="coffee-modal-qr-skeleton" />
                        <div className="coffee-modal-line-skeleton" />
                        <div className="coffee-modal-line-skeleton short" />
                    </div>
                )}

                {state === 'error' && (
                    <div className="coffee-modal-error" aria-live="polite">
                        <p>{errorMessage}</p>
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={() => void loadQuote(parsedAudAmount ?? DEFAULT_DONATION_AUD)}
                        >
                            Retry
                        </button>
                    </div>
                )}

                {state === 'ready' && quote && (
                    <>
                        <div className="coffee-modal-qr-wrap">
                            <img src={qrDataUrl} alt="Donation payment QR code" className="coffee-modal-qr" />
                        </div>

                        <div className="coffee-modal-details">
                            <div>
                                <label htmlFor="coffee-aud-amount" className="label">Donation amount (AUD)</label>
                                <div className="coffee-modal-amount-row">
                                    <input
                                        id="coffee-aud-amount"
                                        type="number"
                                        min="0.01"
                                        step="0.01"
                                        className="input coffee-modal-amount-input"
                                        value={audAmountInput}
                                        onChange={(event) => setAudAmountInput(event.target.value)}
                                    />
                                    <button
                                        type="button"
                                        className="btn btn-secondary"
                                        disabled={!parsedAudAmount}
                                        onClick={() => {
                                            if (!parsedAudAmount) return
                                            void loadQuote(parsedAudAmount)
                                        }}
                                    >
                                        Update QR
                                    </button>
                                </div>
                                {!parsedAudAmount && (
                                    <p className="coffee-modal-input-error">Enter an amount greater than 0.</p>
                                )}
                            </div>
                            <div>
                                <span className="label">Recipient</span>
                                <p className="coffee-modal-value">{quote.recipientName}</p>
                                <p className="coffee-modal-subvalue" title={quote.recipientAddress}>{quote.recipientAddress}</p>
                            </div>
                            <div>
                                <span className="label">Amount</span>
                                <p className="coffee-modal-value">A${quote.audAmount.toFixed(2)} ({algoAmountText} ALGO)</p>
                                <p className="coffee-modal-subvalue">Rate: 1 ALGO = A${exchangeRateText}</p>
                            </div>
                            <div>
                                <span className="label">Note</span>
                                <p className="coffee-modal-value">{quote.note}</p>
                            </div>
                        </div>

                        {quote.isCached && (
                            <p className="coffee-modal-cache" aria-live="polite">
                                Live quote unavailable. Using the last successful quote from this session.
                            </p>
                        )}

                        <div className="coffee-modal-actions">
                            <button type="button" className="btn btn-secondary" onClick={() => void handleCopy()}>
                                {copyState === 'copied' ? 'Payment link copied' : copyState === 'failed' ? 'Copy failed' : 'Copy payment link'}
                            </button>
                            <a
                                href={quote.peraUri}
                                className="btn btn-primary"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Open in Pera
                            </a>
                        </div>
                    </>
                )}
            </section>
        </div>
    )
}
