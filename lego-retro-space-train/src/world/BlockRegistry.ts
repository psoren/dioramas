// Block signaling for trains. Each graph edge is a "block" — only ONE
// train may occupy it at a time. A train claims an edge when it enters,
// holds the claim until its tail has cleared the block, then releases.
//
// One BlockRegistry per graph: edges from different graphs never share a
// block (their ids live in different namespaces).

export class BlockRegistry {
  private ownerByEdgeId = new Map<string, unknown>();

  /** Claim `edgeId` for `owner`. Returns true if the claim succeeded —
   *  either the block was free, or `owner` already held it. Returns
   *  false if another train currently holds it. */
  tryClaim(edgeId: string, owner: unknown): boolean {
    const current = this.ownerByEdgeId.get(edgeId);
    if (current === undefined) {
      this.ownerByEdgeId.set(edgeId, owner);
      return true;
    }
    return current === owner;
  }

  /** Release `edgeId` if `owner` is the current claimant. No-op
   *  otherwise (so a wrong-owner call can't free another train's block). */
  release(edgeId: string, owner: unknown): void {
    if (this.ownerByEdgeId.get(edgeId) === owner) {
      this.ownerByEdgeId.delete(edgeId);
    }
  }

  /** True if `edgeId` is held by someone OTHER than `owner`. Lets a
   *  train check a lookahead block without claiming it. */
  isHeldByOther(edgeId: string, owner: unknown): boolean {
    const current = this.ownerByEdgeId.get(edgeId);
    return current !== undefined && current !== owner;
  }
}
