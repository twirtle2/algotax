import { Region, SupportedCurrency } from '@/types'

export interface RegionConfig {
    id: Region
    name: string
    flag: string
    currency: SupportedCurrency
    fyStartMonth: number // 0-indexed (0 = Jan, 6 = July)
    fyStartDay: number
}

export const REGION_CONFIGS: Record<Region, RegionConfig> = {
    AU: {
        id: 'AU',
        name: 'Australia',
        flag: '🇦🇺',
        currency: 'AUD',
        fyStartMonth: 6, // July
        fyStartDay: 1,
    },
    US: {
        id: 'US',
        name: 'United States',
        flag: '🇺🇸',
        currency: 'USD',
        fyStartMonth: 0, // January
        fyStartDay: 1,
    },
    GB: {
        id: 'GB',
        name: 'United Kingdom',
        flag: '🇬🇧',
        currency: 'GBP',
        fyStartMonth: 3, // April
        fyStartDay: 6,
    },
    CA: {
        id: 'CA',
        name: 'Canada',
        flag: '🇨🇦',
        currency: 'CAD',
        fyStartMonth: 0, // January
        fyStartDay: 1,
    },
    EU: {
        id: 'EU',
        name: 'Europe',
        flag: '🇪🇺',
        currency: 'EUR',
        fyStartMonth: 0, // January
        fyStartDay: 1,
    },
}
