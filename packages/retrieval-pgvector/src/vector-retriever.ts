import type { CodeChunk, BoundedPrompt } from './types.js';
import { ASTChunker } from './ast-chunker.js';

export interface RetrievalLimits {
  topK: number;
  maxTokensApprox: number;
}

export class VectorRetriever {
  private chunks: CodeChunk[] = [];
  private readonly defaultLimits: RetrievalLimits = {
    topK: 5,
    maxTokensApprox: 2000,
  };

  constructor(initialChunks: CodeChunk[] = []) {
    this.chunks = [...initialChunks];
  }

  public indexCode(filePath: string, sourceCode: string): void {
    const newChunks = ASTChunker.chunkSource(filePath, sourceCode);
    // Invalidate existing chunks for this file
    this.chunks = this.chunks.filter(c => c.filePath !== filePath);
    this.chunks.push(...newChunks);
  }

  /**
   * Retrieves top-K relevant chunks using Cosine Similarity against query vector.
   */
  public retrieveTopK(
    query: string,
    limits?: Partial<RetrievalLimits>
  ): CodeChunk[] {
    const effectiveLimits: RetrievalLimits = {
      ...this.defaultLimits,
      ...limits,
    };

    const queryEmbedding = ASTChunker.generateDeterministicEmbedding(query);

    const scored = this.chunks.map(chunk => ({
      chunk,
      score: this.cosineSimilarity(queryEmbedding, chunk.embedding),
    }));

    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    return scored.slice(0, effectiveLimits.topK).map(s => s.chunk);
  }

  /**
   * Assembles a bounded prompt strictly enforcing token and chunk budgets.
   */
  public assembleBoundedPrompt(
    systemPrompt: string,
    query: string,
    limits?: Partial<RetrievalLimits>
  ): BoundedPrompt {
    const topChunks = this.retrieveTopK(query, limits);
    const effectiveLimits: RetrievalLimits = {
      ...this.defaultLimits,
      ...limits,
    };

    const retrievedContext: string[] = [];
    const provenance = [];
    let tokenCount = 0;

    for (const chunk of topChunks) {
      const approxTokens = Math.ceil(chunk.content.length / 4);
      if (tokenCount + approxTokens > effectiveLimits.maxTokensApprox) {
        break; // Strict context limit enforced
      }

      tokenCount += approxTokens;
      retrievedContext.push(`// Source: ${chunk.filePath} [L${chunk.startLine}-L${chunk.endLine}]\n${chunk.content}`);
      provenance.push({
        chunkId: chunk.chunkId,
        filePath: chunk.filePath,
        lines: [chunk.startLine, chunk.endLine] as [number, number],
      });
    }

    const userContext = retrievedContext.join('\n\n');

    return {
      systemPrompt,
      userContext,
      retrievedChunks: provenance,
      totalChunks: provenance.length,
      totalTokensApprox: tokenCount,
    };
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    let dot = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      dot += (a[i] ?? 0) * (b[i] ?? 0);
    }
    return dot;
  }
}
