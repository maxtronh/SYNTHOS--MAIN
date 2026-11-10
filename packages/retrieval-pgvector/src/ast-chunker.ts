import type { CodeChunk } from './types.js';

export class ASTChunker {
  /**
   * Deterministically chunks TypeScript source code into symbol-bounded units
   * retaining strict file path and line number provenance.
   */
  public static chunkSource(filePath: string, sourceCode: string): CodeChunk[] {
    const chunks: CodeChunk[] = [];
    const lines = sourceCode.split('\n');

    // Structural regex for TypeScript declarations
    const symbolRegex = /^(?:export\s+)?(?:default\s+)?(function|interface|type|class)\s+([a-zA-Z0-9_$]+)/;

    let currentSymbol: {
      type: 'function' | 'interface' | 'type' | 'class';
      name: string;
      startLine: number;
      lines: string[];
      braceCount: number;
    } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const lineNum = i + 1;

      if (!currentSymbol) {
        const match = symbolRegex.exec(line.trim());
        if (match) {
          const type = match[1] as 'function' | 'interface' | 'type' | 'class';
          const name = match[2]!;
          const opens = (line.match(/{/g) || []).length;
          const closes = (line.match(/}/g) || []).length;

          currentSymbol = {
            type,
            name,
            startLine: lineNum,
            lines: [line],
            braceCount: opens - closes,
          };

          // One-liner check
          if (line.includes(';') || (opens > 0 && opens === closes)) {
            chunks.push(this.createChunk(filePath, currentSymbol, lineNum));
            currentSymbol = null;
          }
        }
      } else {
        currentSymbol.lines.push(line);
        const opens = (line.match(/{/g) || []).length;
        const closes = (line.match(/}/g) || []).length;
        currentSymbol.braceCount += opens - closes;

        if (currentSymbol.braceCount <= 0 && currentSymbol.lines.length > 1) {
          chunks.push(this.createChunk(filePath, currentSymbol, lineNum));
          currentSymbol = null;
        }
      }
    }

    // Fallback if no symbols parsed or remaining code
    if (chunks.length === 0 && sourceCode.trim().length > 0) {
      chunks.push({
        chunkId: `${filePath}:1:${lines.length}`,
        filePath,
        startLine: 1,
        endLine: lines.length,
        symbolType: 'class',
        symbolName: 'ModuleRoot',
        content: sourceCode,
        embedding: this.generateDeterministicEmbedding(sourceCode),
      });
    }

    return chunks;
  }

  private static createChunk(
    filePath: string,
    sym: { type: 'function' | 'interface' | 'type' | 'class'; name: string; startLine: number; lines: string[] },
    endLine: number
  ): CodeChunk {
    const content = sym.lines.join('\n');
    return {
      chunkId: `${filePath}:${sym.startLine}:${endLine}`,
      filePath,
      startLine: sym.startLine,
      endLine,
      symbolType: sym.type,
      symbolName: sym.name,
      content,
      embedding: this.generateDeterministicEmbedding(content),
    };
  }

  /**
   * Deterministic embedding vector generation for mock / offline testing
   */
  public static generateDeterministicEmbedding(text: string, dimensions: number = 8): number[] {
    const vector = new Array(dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      const charCode = text.charCodeAt(i);
      const dim = i % dimensions;
      vector[dim] += charCode;
    }
    // Normalize vector
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vector.map(v => v / norm);
  }
}
