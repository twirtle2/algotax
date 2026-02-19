import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AppSettings, WalletConfig, SupportedCurrency, KoinlyExportOptions } from '@/types'

interface AppStore extends AppSettings {
    // Actions
    setFinancialYear: (fy: string) => void
    setCurrency: (currency: SupportedCurrency) => void
    addWallet: (wallet: WalletConfig) => void
    removeWallet: (address: string) => void
    updateWalletLabel: (address: string, label: string) => void
    getWalletAddresses: () => string[]
    isOwnAddress: (address: string) => boolean
    // Koinly Export Options
    koinlyOptions: KoinlyExportOptions
    setKoinlyOptions: (options: KoinlyExportOptions | ((prev: KoinlyExportOptions) => KoinlyExportOptions)) => void
}

export const useAppStore = create<AppStore>()(
    persist(
        (set, get) => ({
            // State
            financialYear: '2025-26',
            currency: 'AUD',
            wallets: [],
            koinlyOptions: {
                dustThreshold: 0.01,
                excludeNFTs: true,
                excludeOwnTransfers: true,
                excludeOptIns: true,
                excludeZeroAmount: true,
                excludeASAs: false,
                whitelistedAssetIds: [],
                exportAllHistory: false,
            },

            // Actions
            setFinancialYear: (fy) => set({ financialYear: fy }),
            setCurrency: (currency) => set({ currency }),

            addWallet: (wallet) =>
                set((state) => {
                    if (state.wallets.some((w) => w.address === wallet.address)) return state
                    return { wallets: [...state.wallets, wallet] }
                }),

            removeWallet: (address) =>
                set((state) => ({
                    wallets: state.wallets.filter((w) => w.address !== address),
                })),

            updateWalletLabel: (address, label) =>
                set((state) => ({
                    wallets: state.wallets.map((w) =>
                        w.address === address ? { ...w, label } : w
                    ),
                })),

            getWalletAddresses: () => get().wallets.map((w) => w.address),

            isOwnAddress: (address) =>
                get().wallets.some((w) => w.address.toLowerCase() === address.toLowerCase()),

            setKoinlyOptions: (options) =>
                set((state) => ({
                    koinlyOptions: typeof options === 'function' ? options(state.koinlyOptions) : options
                })),
        }),
        {
            name: 'algo-tax-settings',
        }
    )
)
