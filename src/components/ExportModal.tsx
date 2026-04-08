import { useEffect } from 'react'

interface ExportModalProps {
    isOpen: boolean
    onClose: () => void
    onSelectFormat: (format: 'koinly' | 'cointracker') => void
}

export default function ExportModal({ isOpen, onClose, onSelectFormat }: ExportModalProps) {
    useEffect(() => {
        if (!isOpen) return

        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'

        return () => {
            document.body.style.overflow = previousOverflow
        }
    }, [isOpen])

    useEffect(() => {
        if (!isOpen) return

        const handleEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose()
            }
        }

        window.addEventListener('keydown', handleEscape)
        return () => window.removeEventListener('keydown', handleEscape)
    }, [isOpen, onClose])

    if (!isOpen) return null

    return (
        <div
            className="export-modal-overlay"
            onClick={(event) => {
                if (event.target === event.currentTarget) {
                    onClose()
                }
            }}
        >
            <section
                className="export-modal"
                role="dialog"
                aria-modal="true"
                aria-labelledby="export-modal-title"
            >
                <header className="export-modal-header">
                    <div>
                        <h3 id="export-modal-title">Choose export format</h3>
                        <p>Select the tax software format to download.</p>
                    </div>
                </header>

                <div className="export-modal-actions">
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => onSelectFormat('koinly')}
                    >
                        Koinly
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => onSelectFormat('cointracker')}
                    >
                        CoinTracker
                    </button>
                </div>

                <button
                    type="button"
                    className="btn-text export-modal-cancel"
                    onClick={onClose}
                >
                    Cancel
                </button>
            </section>
        </div>
    )
}
