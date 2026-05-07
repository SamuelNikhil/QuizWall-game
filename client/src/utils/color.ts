// ==========================================
// Color Utilities — shared across controllers
// ==========================================

/**
 * Convert a hex color string to an rgba() CSS value.
 * Supports 3-char and 6-char hex (with or without leading #).
 */
export function hexToRgba(hex: string, alpha: number): string {
    const normalized = hex.replace('#', '');
    const safeHex =
        normalized.length === 3
            ? normalized
                  .split('')
                  .map((char) => char + char)
                  .join('')
            : normalized;

    const r = parseInt(safeHex.slice(0, 2), 16);
    const g = parseInt(safeHex.slice(2, 4), 16);
    const b = parseInt(safeHex.slice(4, 6), 16);

    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
