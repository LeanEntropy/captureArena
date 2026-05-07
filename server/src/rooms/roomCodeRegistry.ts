// In-memory map of human-readable 6-char codes → Colyseus roomIds.
// Codes use a 32-char alphabet that omits visually confusing pairs:
//   no 0/O, no 1/I/L. → ABCDEFGHJKLMNPQRSTUVWXYZ23456789
// 32^6 = ~1B codes; collisions are negligible. The room caller still retries
// register() up to 3 times if generateCode() happens to clash.

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;

const codes = new Map<string, string>(); // code → roomId

export function generateCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += ALPHABET.charAt(Math.floor(Math.random() * ALPHABET.length));
  }
  return out;
}

export function register(code: string, roomId: string): boolean {
  if (codes.has(code)) return false;
  codes.set(code, roomId);
  return true;
}

export function release(code: string): void {
  codes.delete(code);
}

export function lookup(code: string): string | null {
  return codes.get(code) ?? null;
}

// Test-only reset hook.
export function _resetForTest(): void {
  codes.clear();
}
