// Free, on-CPU models for the cheap funnel stages (Ring CV guidelines, Stages 1 and 2):
//  - Stage 1 object gate: YOLOS-tiny (COCO) answers "is there a person / vehicle / animal in this frame?"
//  - Stage 2 zero-shot: CLIP ViT-B/32 compares the frame with short descriptions ("a home care worker
//    in scrubs carrying a bag", "a silver hatchback") without any training. Attire and vehicles only:
//    Homebeat never identifies people by their face.
import { join } from 'node:path'
import { config } from '../config.ts'

type Detector = (image: unknown, opts: { threshold: number; percentage?: boolean }) => Promise<{ label: string; score: number; box: { xmin: number; ymin: number; xmax: number; ymax: number } }[]>
type ZeroShot = (image: unknown, labels: string[], opts?: { hypothesis_template?: string }) => Promise<{ label: string; score: number }[]>

type Embedder = (image: unknown) => Promise<number[]>

let detectorP: Promise<Detector> | null = null
let clipP: Promise<ZeroShot> | null = null
let embedP: Promise<Embedder> | null = null

async function transformers() {
  const t = await import('@huggingface/transformers')
  t.env.cacheDir = join(config.dataDir, 'models')
  return t
}

async function rawImage(jpeg: Buffer) {
  const { RawImage } = await transformers()
  return RawImage.fromBlob(new Blob([new Uint8Array(jpeg)]))
}

export function warmUp() {
  if (config.cv.stage1) void detector().catch(() => undefined)
  if (config.cv.stage2) void clip().catch(() => undefined)
}

function detector(): Promise<Detector> {
  detectorP ??= transformers().then(async (t) => {
    const p = await t.pipeline('object-detection', 'Xenova/yolos-tiny', { dtype: 'q8' })
    // Doorstep subjects fill the frame, so a smaller input is enough: 3.5 s -> 0.5 s per frame on CPU
    // with the same people/vehicle detections in our tests.
    ;(p as unknown as { processor: { image_processor: { size: unknown } } }).processor.image_processor.size = { shortest_edge: 384, longest_edge: 640 }
    return p as unknown as Detector
  })
  return detectorP
}

function clip(): Promise<ZeroShot> {
  clipP ??= transformers().then(
    (t) => t.pipeline('zero-shot-image-classification', 'Xenova/clip-vit-base-patch32', { dtype: 'q8' }) as unknown as Promise<ZeroShot>,
  )
  return clipP
}

// CLIP image embeddings (same ViT-B/32 weights as the zero-shot stage), for "is this the same view?".
function embedder(): Promise<Embedder> {
  embedP ??= transformers().then(async (t) => {
    const id = 'Xenova/clip-vit-base-patch32'
    const processor = await t.AutoProcessor.from_pretrained(id)
    const model = await t.CLIPVisionModelWithProjection.from_pretrained(id, { dtype: 'q8' })
    return async (image: unknown) => {
      const { image_embeds } = await model(await processor(image))
      const v = Array.from(image_embeds.data as Float32Array)
      const n = Math.hypot(...v) || 1
      return v.map((x) => x / n)
    }
  })
  return embedP
}

// Cosine similarity of two frames. On real Ring Playground frames: the same doorstep 0.96-0.98, a different
// view 0.52-0.73. Used before a re-check draws a conclusion from a frame ("package gone").
export async function viewSimilarity(a: Buffer, b: Buffer): Promise<number> {
  const embed = await embedder()
  const [x, y] = [await embed(await rawImage(a)), await embed(await rawImage(b))]
  return x.reduce((sum, v, i) => sum + v * y[i], 0)
}
export const SAME_VIEW = 0.85

export const PERSON = new Set(['person'])
export const VEHICLE = new Set(['car', 'truck', 'bus', 'motorcycle', 'bicycle'])
export const ANIMAL = new Set(['cat', 'dog', 'bird', 'horse', 'sheep', 'cow', 'bear'])
export const CARRIED = new Set(['handbag', 'backpack', 'suitcase', 'umbrella'])

export interface Detection {
  label: string
  score: number
  area: number // fraction of the frame
}

export async function detectObjects(jpeg: Buffer, threshold = 0.55): Promise<Detection[]> {
  const run = await detector()
  const img = await rawImage(jpeg)
  const out = await run(img, { threshold, percentage: true })
  return out
    .map((o) => ({ label: o.label, score: o.score, area: Math.max(0, (o.box.xmax - o.box.xmin) * (o.box.ymax - o.box.ymin)) }))
    .sort((a, b) => b.score - a.score)
}

export async function zeroShot(jpeg: Buffer, labels: string[]): Promise<{ label: string; score: number }[]> {
  const run = await clip()
  const img = await rawImage(jpeg)
  return run(img, labels)
}
