export interface CodeChunk {
  chunkId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  symbolType: 'function' | 'interface' | 'type' | 'class';
  symbolName: string;
  content: string;
  embedding: number[];
}

export interface SourceProvenance {
  chunkId: string;
  filePath: string;
  lines: [number, number];
}

export interface BoundedPrompt {
  systemPrompt: string;
  userContext: string;
  retrievedChunks: SourceProvenance[];
  totalChunks: number;
  totalTokensApprox: number;
}
