/**
 * Calculate the Unix timestamp boundaries for a financial year (AU: July 1 to June 30)
 * @param fy Format "YYYY-YY" e.g., "2024-25"
 */
export function getFYBoundaries(fy: string | undefined): { start: number; end: number } {
    const startYear = parseInt((fy || '').split('-')[0] || '')
    if (isNaN(startYear)) {
        // Fallback for malformed strings
        const currentYear = new Date().getFullYear()
        return {
            start: new Date(currentYear, 6, 1, 0, 0, 0).getTime() / 1000,
            end: new Date(currentYear + 1, 5, 30, 23, 59, 59).getTime() / 1000
        }
    }
    const start = new Date(startYear, 6, 1, 0, 0, 0).getTime() / 1000 // July 1
    const end = new Date(startYear + 1, 5, 30, 23, 59, 59).getTime() / 1000 // June 30
    return { start, end }
}
