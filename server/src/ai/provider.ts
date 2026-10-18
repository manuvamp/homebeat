// Vision + text model access behind one interface. Three interchangeable backends:
//  - bedrock:   Amazon Bedrock Converse API (production path in Ring's CV guidelines)
//  - anthropic: Anthropic Messages API
//  - openai:    any OpenAI-compatible endpoint (default: a local proxy for development)
// All calls ask for a single JSON object back; parseJson tolerates code fences.
import { config } from '../config.ts'

export interface ImageInput {
  bytes: Buffer
  mediaType: 'image/jpeg' | 'image/png'
}

export interface ModelCall {
  system: string
  prompt: string
  images?: ImageInput[]
  maxTokens?: number
  model?: 'vision' | 'text'
}

export class AiUnavailable extends Error {}

export function parseJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = (fenced ? fenced[1] : text).trim()
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`Model did not return JSON: ${text.slice(0, 120)}`)
  return JSON.parse(raw.slice(start, end + 1)) as T
}

export async function askJson<T>(call: ModelCall): Promise<T> {
  const text = await complete(call)
  return parseJson<T>(text)
}

export function aiEnabled() {
  return config.ai.provider !== 'none'
}

async function complete(call: ModelCall): Promise<string> {
  switch (config.ai.provider) {
    case 'bedrock':
      return bedrock(call)
    case 'anthropic':
      return anthropic(call)
    case 'openai':
      return openai(call)
    default:
      throw new AiUnavailable('AI provider disabled (AI_PROVIDER=none)')
  }
}

const reasoningEffort = () => process.env.AI_REASONING_EFFORT ?? 'low'

async function openai(call: ModelCall): Promise<string> {
  const model = call.model === 'text' ? config.ai.textModel : config.ai.visionModel
  const content = [
    { type: 'text', text: call.prompt },
    ...(call.images ?? []).map((img) => ({
      type: 'image_url',
      image_url: { url: `data:${img.mediaType};base64,${img.bytes.toString('base64')}` },
    })),
  ]
  const res = await fetch(`${config.ai.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.ai.apiKey}` },
    body: JSON.stringify({
      model,
      // Some OpenAI-compatible gateways run models with hidden reasoning that counts against max_tokens;
      // a small cap then returns an empty answer with finish_reason "length". Leave headroom.
      max_tokens: Math.max(call.maxTokens ?? 400, Number(process.env.AI_MIN_MAX_TOKENS ?? 2000)),
      temperature: 0,
      // One frame + short JSON doesn't need deliberation: 'low' took a doorstep call from ~6 s to ~1 s.
      // Set AI_REASONING_EFFORT= (empty) for endpoints that reject the parameter.
      ...(reasoningEffort() ? { reasoning_effort: reasoningEffort() } : {}),
      messages: [
        { role: 'system', content: call.system },
        { role: 'user', content },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new AiUnavailable(`Model endpoint ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const body = (await res.json()) as { choices: { message: { content: string } }[] }
  return body.choices[0]?.message?.content ?? ''
}

async function anthropic(call: ModelCall): Promise<string> {
  if (!config.ai.anthropicKey) throw new AiUnavailable('Set ANTHROPIC_API_KEY_HOMEBEAT')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.ai.anthropicKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: call.model === 'text' ? config.ai.textModel : config.ai.visionModel,
      max_tokens: call.maxTokens ?? 400,
      system: call.system,
      messages: [
        {
          role: 'user',
          content: [
            ...(call.images ?? []).map((img) => ({
              type: 'image',
              source: { type: 'base64', media_type: img.mediaType, data: img.bytes.toString('base64') },
            })),
            { type: 'text', text: call.prompt },
          ],
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  })
  if (!res.ok) throw new AiUnavailable(`Anthropic ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const body = (await res.json()) as { content: { type: string; text?: string }[] }
  return body.content.find((c) => c.type === 'text')?.text ?? ''
}

let bedrockClient: unknown
async function bedrock(call: ModelCall): Promise<string> {
  const { BedrockRuntimeClient, ConverseCommand } = await import('@aws-sdk/client-bedrock-runtime')
  bedrockClient ??= new BedrockRuntimeClient({ region: config.ai.awsRegion })
  const client = bedrockClient as InstanceType<typeof BedrockRuntimeClient>
  const out = await client.send(
    new ConverseCommand({
      modelId: config.ai.bedrockModel,
      system: [{ text: call.system }],
      inferenceConfig: { maxTokens: call.maxTokens ?? 400, temperature: 0 },
      messages: [
        {
          role: 'user',
          content: [
            ...(call.images ?? []).map((img) => ({
              image: { format: img.mediaType === 'image/png' ? ('png' as const) : ('jpeg' as const), source: { bytes: img.bytes } },
            })),
            { text: call.prompt },
          ],
        },
      ],
    }),
  )
  return out.output?.message?.content?.map((c) => c.text ?? '').join('') ?? ''
}
