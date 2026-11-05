import { z } from "zod";
import { voyageConfig } from "../config";
import { AppError } from "../errors";
import { fetchWithRetry, type RetryOptions } from "./http";

/**
 * Voyage embeddings: POST https://api.voyageai.com/v1/embeddings with model
 * voyage-4 and output_dimension 1024. Listings are embedded as "document",
 * searches as "query".
 */

const EMBEDDING_MODEL = "voyage-4";
const EMBEDDING_DIMENSION = 1024;

const responseSchema = z.object({
  data: z.array(z.object({ embedding: z.array(z.number()), index: z.number().int() })),
  usage: z.object({ total_tokens: z.number() }).optional(),
});

type Deps = RetryOptions & { apiKey?: () => string };

export class VoyageClient {
  constructor(private readonly deps: Deps = {}) {}

  async embed(texts: string[], inputType: "document" | "query"): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length > 1000) throw new Error("Voyage accepts at most 1000 inputs per request");
    const apiKey = this.deps.apiKey ? this.deps.apiKey() : voyageConfig().VOYAGE_API_KEY;
    let res: Response;
    try {
      res = await fetchWithRetry(
        "https://api.voyageai.com/v1/embeddings",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            input: texts,
            model: EMBEDDING_MODEL,
            input_type: inputType,
            output_dimension: EMBEDDING_DIMENSION,
          }),
        },
        this.deps,
      );
    } catch {
      throw new AppError("UPSTREAM_ERROR", "The search service is unreachable right now.");
    }
    if (res.status === 429) throw new AppError("RATE_LIMITED", "The search service is busy; please try again shortly.");
    if (!res.ok) throw new AppError("UPSTREAM_ERROR", `The search service returned HTTP ${res.status}.`);
    const body = responseSchema.parse(await res.json());
    const out: (number[] | undefined)[] = Array.from({ length: texts.length }, () => undefined);
    for (const d of body.data) {
      if (d.embedding.length !== EMBEDDING_DIMENSION) {
        throw new Error(`Voyage returned ${d.embedding.length} dimensions, expected ${EMBEDDING_DIMENSION}`);
      }
      out[d.index] = d.embedding;
    }
    return out.map((e, i) => {
      if (!e) throw new Error(`Voyage response is missing embedding ${i}`);
      return e;
    });
  }
}

export const voyage = new VoyageClient();

export type EmbeddingApi = Pick<VoyageClient, "embed">;
