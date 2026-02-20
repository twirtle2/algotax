import { useState, useRef, useCallback, useEffect } from 'react'
import { useAppStore } from '@/store/appStore'
import { db, upsertTransactions, exportAllData, importData, clearAllData } from '@/db'
import { fetchAllTransactions, type FetchProgress } from '@/services/nodely'
import { classifyAllTransactions, reclassifyTransactions } from '@/services/classifier'
import type { WalletConfig, SupportedCurrency } from '@/types'

export default function Settings() {
    const wallets = useAppStore((s) => s.wallets)
    const addWallet = useAppStore((s) => s.addWallet)
    const removeWallet = useAppStore((s) => s.removeWallet)
    const currency = useAppStore((s) => s.currency)
    const setCurrency = useAppStore((s) => s.setCurrency)

    const [newAddress, setNewAddress] = useState('')
    const [newLabel, setNewLabel] = useState('')
    const [syncing, setSyncing] = useState(false)
    const [syncProgress, setSyncProgress] = useState<Record<string, string>>({})

    const importInputRef = useRef<HTMLInputElement>(null)

    // ─── Add Wallet ─────────────────────────────────────────────────
    const handleAddWallet = () => {
        if (!newAddress.trim()) return
        if (newAddress.length < 50) {
            alert('Invalid Algorand address. Addresses are 58 characters long.')
            return
        }
        const wallet: WalletConfig = {
            address: newAddress.trim(),
            label: newLabel.trim() || `Wallet ${wallets.length + 1}`,
            addedAt: Date.now(),
        }
        addWallet(wallet)
        db.wallets.put(wallet)
        setNewAddress('')
        setNewLabel('')
    }

    // ─── Sync Wallet Transactions ─────────────────────────────────
    const syncWallet = useCallback(async (address: string, forceFull = false) => {
        setSyncProgress((p) => ({ ...p, [address]: 'Pre-caching assets...' }))

        try {
            let afterTime: string | undefined = undefined

            if (!forceFull) {
                // Delta Sync: Find latest transaction for this address
                const latestFrom = await db.transactions.where('fromAddress').equals(address).reverse().first()
                const latestTo = await db.transactions.where('toAddress').equals(address).reverse().first()
                const maxTimestamp = Math.max(latestFrom?.timestamp ?? 0, latestTo?.timestamp ?? 0)

                // Overlap by 24h to catch any late-settling or group-linked transactions
                if (maxTimestamp > 0) {
                    afterTime = new Date((maxTimestamp - 86400) * 1000).toISOString()
                }
            }

            setSyncProgress((p) => ({
                ...p,
                [address]: `Fetching transactions${afterTime ? ` since ${afterTime.split('T')[0]}` : ''}...`
            }))

            const rawTxns = await fetchAllTransactions(address, {
                afterTime,
                onProgress: (progress: FetchProgress) => {
                    setSyncProgress((p) => ({
                        ...p,
                        [address]: `Fetched ${progress.fetchedCount} txns (page ${progress.currentPage})${progress.hasMore ? '...' : ''}`,
                    }))
                },
            })

            setSyncProgress((p) => ({ ...p, [address]: `Classifying ${rawTxns.length} transactions...` }))

            const classified = await classifyAllTransactions(
                rawTxns,
                wallets.map((w) => w.address),
            )

            await upsertTransactions(classified)

            setSyncProgress((p) => ({
                ...p,
                [address]: `✅ ${forceFull ? 'Full Re-sync' : 'Synced'} ${classified.length} transactions`,
            }))
        } catch (err) {
            setSyncProgress((p) => ({
                ...p,
                [address]: `❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`,
            }))
        }
    }, [wallets])

    // ─── Sync All Wallets ─────────────────────────────────────────
    const syncAllWallets = async (forceFull = false) => {
        setSyncing(true)
        for (const wallet of wallets) {
            await syncWallet(wallet.address, forceFull)
        }
        setSyncing(false)
    }

    // ─── Data Export/Import ───────────────────────────────────────
    const handleExport = async () => {
        const json = await exportAllData()
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `algotax-backup-${new Date().toISOString().slice(0, 10)}.json`
        a.click()
        URL.revokeObjectURL(url)
    }

    const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0]
        if (!file) return
        try {
            const json = await file.text()
            await importData(json)
            alert('Data imported successfully!')
        } catch (err) {
            alert(`Import failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
        if (importInputRef.current) importInputRef.current.value = ''
    }

    const [clearLabel, setClearLabel] = useState('🗑️ Clear All Data')
    const clearConfirmedRef = useRef(false)
    const mountedRef = useRef(true)

    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
        }
    }, [])

    const handleClearData = async () => {
        if (!clearConfirmedRef.current) {
            clearConfirmedRef.current = true
            setClearLabel('⚠️ Click again to confirm deletion')
            setTimeout(() => {
                clearConfirmedRef.current = false
                if (mountedRef.current) setClearLabel('🗑️ Clear All Data')
            }, 5000)
            return
        }
        clearConfirmedRef.current = false
        try {
            setClearLabel('⏳ Clearing...')
            await clearAllData()
            if (mountedRef.current) {
                setClearLabel('✅ All data cleared!')
                setTimeout(() => {
                    if (mountedRef.current) setClearLabel('🗑️ Clear All Data')
                }, 3000)
            }
        } catch (err) {
            console.error('Clear data error:', err)
            if (mountedRef.current) setClearLabel('🗑️ Clear All Data')
        }
    }

    return (
        <div>
            <div className="page-header">
                <h2>Settings</h2>
                <p>Configure wallets and manage your data</p>
            </div>

            {/* ─── Wallet Management ─────────────────────────────────── */}
            <div className="settings-section">
                <h3>Algorand Wallets</h3>
                <div className="card mb-lg">
                    <div className="flex gap-sm" style={{ marginBottom: 'var(--space-md)' }}>
                        <input
                            type="text"
                            className="input"
                            placeholder="Algorand address (58 characters)"
                            value={newAddress}
                            onChange={(e) => setNewAddress(e.target.value)}
                            style={{ flex: 2 }}
                        />
                        <input
                            type="text"
                            className="input"
                            placeholder="Label (optional)"
                            value={newLabel}
                            onChange={(e) => setNewLabel(e.target.value)}
                            style={{ flex: 1 }}
                        />
                        <button className="btn btn-primary" onClick={handleAddWallet}>
                            Add
                        </button>
                    </div>

                    {wallets.length > 0 ? (
                        <>
                            <div className="wallet-list">
                                {wallets.map((wallet) => (
                                    <div key={wallet.address} className="wallet-item">
                                        <span className="label">{wallet.label}</span>
                                        <span className="address">{wallet.address}</span>
                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                                            {syncProgress[wallet.address] ?? ''}
                                        </span>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => syncWallet(wallet.address, false)}
                                            disabled={syncing}
                                        >
                                            Sync
                                        </button>
                                        <button
                                            className="btn btn-sm btn-secondary"
                                            onClick={() => {
                                                if (confirm(`Full Re-sync for ${wallet.label}? This will refetch all transactions from the beginning.`)) {
                                                    syncWallet(wallet.address, true)
                                                }
                                            }}
                                            disabled={syncing}
                                            title="Force a full re-sync from the beginning of time"
                                        >
                                            ⚡ Force Sync
                                        </button>
                                        <button
                                            className="btn btn-sm btn-danger"
                                            onClick={async () => {
                                                if (!confirm(`Are you sure? This will remove the wallet and its associated transactions from the database.`)) return

                                                removeWallet(wallet.address)
                                                await db.wallets.delete(wallet.address)

                                                // Cleanup orphaned transactions
                                                const remainingAddresses = new Set(
                                                    wallets.filter(w => w.address !== wallet.address).map(w => w.address.toUpperCase())
                                                )

                                                const myAddress = wallet.address.toUpperCase()
                                                const problematicTxns = await db.transactions
                                                    .where('fromAddress').equals(wallet.address)
                                                    .or('toAddress').equals(wallet.address)
                                                    .toArray()

                                                const idsToDelete = problematicTxns
                                                    .filter(tx => {
                                                        const from = tx.fromAddress?.toUpperCase()
                                                        const to = tx.toAddress?.toUpperCase()
                                                        // Keep if the OTHER side is still in our wallet list
                                                        const otherIsTracked = (from === myAddress && to && remainingAddresses.has(to)) ||
                                                            (to === myAddress && from && remainingAddresses.has(from))
                                                        return !otherIsTracked
                                                    })
                                                    .map(tx => tx.id)

                                                if (idsToDelete.length > 0) {
                                                    await db.transactions.bulkDelete(idsToDelete)
                                                }
                                            }}
                                        >
                                            ✕
                                        </button>
                                    </div>
                                ))}
                            </div>

                            <div className="mt-md flex gap-sm">
                                <button
                                    className="btn btn-primary"
                                    onClick={() => syncAllWallets(false)}
                                    disabled={syncing}
                                >
                                    {syncing ? (
                                        <>
                                            <div className="loading-spinner" />
                                            Syncing...
                                        </>
                                    ) : (
                                        '🔄 Sync All Wallets'
                                    )}
                                </button>
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        if (confirm('A Full Re-sync will fetch all transactions from the beginning of time. This may take a while. Proceed?')) {
                                            syncAllWallets(true)
                                        }
                                    }}
                                    disabled={syncing}
                                    title="Fetch all transactions from the beginning to ensure nothing is missed"
                                >
                                    {syncing ? (
                                        <>
                                            <div className="loading-spinner" />
                                            Re-syncing...
                                        </>
                                    ) : (
                                        '🔄⚡ Re-sync All (Full)'
                                    )}
                                </button>
                            </div>
                        </>
                    ) : (
                        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
                            No wallets added yet. Add your Algorand wallet address above.
                        </p>
                    )}
                </div>
            </div>

            {/* ─── Preferences ────────────────────────────────────── */}
            <div className="settings-section">
                <h3>Regional Preferences</h3>
                <div className="card mb-lg">
                    <div className="flex gap-md" style={{ flexWrap: 'wrap' }}>
                        <div className="input-group" style={{ maxWidth: 240 }}>
                            <label>Display Currency</label>
                            <select
                                className="select"
                                value={currency}
                                onChange={(e) => setCurrency(e.target.value as SupportedCurrency)}
                            >
                                <option value="AUD">🇦🇺 AUD</option>
                                <option value="USD">🇺🇸 USD</option>
                                <option value="GBP">🇬🇧 GBP</option>
                                <option value="EUR">🇪🇺 EUR</option>
                                <option value="CAD">🇨🇦 CAD</option>
                            </select>
                            <p className="text-secondary xsmall mt-1">
                                Used for labels in Koinly export.
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Data Management ────────────────────────────────────── */}
            <div className="settings-section">
                <h3>Data Management</h3>
                <div className="card">
                    <div className="flex gap-sm flex-col" style={{ maxWidth: 400 }}>
                        <button className="btn btn-secondary" onClick={handleExport}>
                            📦 Export Backup (JSON)
                        </button>

                        <div>
                            <input
                                ref={importInputRef}
                                type="file"
                                accept=".json"
                                onChange={handleImport}
                                style={{ display: 'none' }}
                            />
                            <button
                                className="btn btn-secondary"
                                onClick={() => importInputRef.current?.click()}
                                style={{ width: '100%' }}
                            >
                                📥 Import Backup (JSON)
                            </button>
                        </div>

                        <div style={{ marginTop: 'var(--space-md)', paddingTop: 'var(--space-md)', borderTop: '1px solid var(--color-border)' }}>
                            <h4 style={{ fontSize: '0.9rem', marginBottom: 'var(--space-sm)' }}>Maintenance</h4>
                            <div className="flex gap-sm">
                                <ReclassifyButton wallets={wallets} />
                                <button
                                    className="btn btn-danger"
                                    onClick={handleClearData}
                                >
                                    {clearLabel}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

function ReclassifyButton({ wallets }: { wallets: WalletConfig[] }) {
    const [status, setStatus] = useState<'idle' | 'processing' | 'done' | 'error'>('idle')
    const [msg, setMsg] = useState('')

    const handleReclassify = async () => {
        setStatus('processing')
        setMsg('Loading transactions...')
        try {
            const allTxns = await db.transactions.toArray()
            if (allTxns.length === 0) {
                setStatus('error')
                setMsg('No transactions to re-classify')
                return
            }

            setMsg(`Re-classifying ${allTxns.length} transactions...`)

            const ownAddresses = wallets.map(w => w.address)
            const updated = await reclassifyTransactions(allTxns, ownAddresses)

            setMsg('Saving updates...')
            await upsertTransactions(updated)

            setStatus('done')
            setMsg(`✅ Re-classified ${updated.length} transactions`)

            setTimeout(() => {
                setStatus('idle')
                setMsg('')
            }, 3000)
        } catch (err) {
            setStatus('error')
            setMsg(`❌ Error: ${err instanceof Error ? err.message : 'Unknown error'}`)
        }
    }

    return (
        <div className="flex items-center gap-sm">
            <button
                className="btn btn-secondary"
                onClick={handleReclassify}
                disabled={status === 'processing'}
            >
                {status === 'processing' ? 'Processing...' : '🔄 Re-classify All'}
            </button>
            {msg && <span className="xsmall text-muted">{msg}</span>}
        </div>
    )
}
