import { Region } from '@/types'
import { REGION_CONFIGS } from '@/constants/regions'

/**

 * Calculate the Unix timestamp boundaries for a financial year (AU: July 1 to June 30)
 * @param fy Format "YYYY-YY" e.g., "2024-25"
 */
export function getFYBoundaries(fy: string | undefined, region: Region = 'AU'): { start: number; end: number } {
    const config = REGION_CONFIGS[region]
    const startYear = parseInt((fy || '').split('-')[0] || '')

    if (isNaN(startYear)) {
        // Fallback for malformed strings
        const currentYear = new Date().getFullYear()
        return {
            start: new Date(currentYear, config.fyStartMonth, config.fyStartDay, 0, 0, 0).getTime() / 1000,
            end: new Date(currentYear + 1, config.fyStartMonth, config.fyStartDay, 0, 0, 0).getTime() / 1000 - 1
        }
    }

    const start = new Date(startYear, config.fyStartMonth, config.fyStartDay, 0, 0, 0).getTime() / 1000
    // End is 1 year after start, minus 1 second
    const end = new Date(startYear + 1, config.fyStartMonth, config.fyStartDay, 0, 0, 0).getTime() / 1000 - 1

    return { start, end }
}

