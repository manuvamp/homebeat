import type { ServerResponse } from 'node:http'
import type { StreamMessage } from '../../shared/types.ts'

// Server-sent events fan-out to every open Homebeat tab.
const clients = new Set<ServerResponse>()

export function addClient(res: ServerResponse) {
  clients.add(res)
  res.on('close', () => clients.delete(res))
}

export function publish(message: StreamMessage) {
  const data = `data: ${JSON.stringify(message)}\n\n`
  for (const res of clients) res.write(data)
}

setInterval(() => {
  for (const res of clients) res.write(': keep-alive\n\n')
}, 20_000).unref()
