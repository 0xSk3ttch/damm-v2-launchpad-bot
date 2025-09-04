export class MigrationTracker {
  private migratedTokens = new Set<string>();
  private expirationTimeouts = new Map<string, NodeJS.Timeout>();

  addToken(tokenMint: string, expirationMs: number = 7 * 60 * 1000): void {
    // Clear any existing timeout for this token
    this.clearExpirationTimeout(tokenMint);
    
    this.migratedTokens.add(tokenMint);
    console.log(`➕ Added migrated token: ${tokenMint}`);
    
    // Set expiration timeout
    const timeout = setTimeout(() => {
      if (this.migratedTokens.has(tokenMint)) {
        console.log(`Token ${tokenMint} expired after ${expirationMs / 1000 / 60} minutes - removing from pending list`);
        this.removeToken(tokenMint);
      }
    }, expirationMs);
    
    this.expirationTimeouts.set(tokenMint, timeout);
  }

  removeToken(tokenMint: string): void {
    this.migratedTokens.delete(tokenMint);
    this.clearExpirationTimeout(tokenMint);
    console.log(`Removed token ${tokenMint} from pending list`);
  }

  hasToken(tokenMint: string): boolean {
    return this.migratedTokens.has(tokenMint);
  }

  getTokenCount(): number {
    return this.migratedTokens.size;
  }

  getTokens(): Set<string> {
    return new Set(this.migratedTokens);
  }

  clearAllTokens(): void {
    for (const token of this.migratedTokens) {
      this.clearExpirationTimeout(token);
    }
    this.migratedTokens.clear();
    console.log('Cleared all migrated tokens');
  }

  private clearExpirationTimeout(tokenMint: string): void {
    const timeout = this.expirationTimeouts.get(tokenMint);
    if (timeout) {
      clearTimeout(timeout);
      this.expirationTimeouts.delete(tokenMint);
    }
  }

  // Cleanup method for graceful shutdown
  cleanup(): void {
    this.clearAllTokens();
  }
}

