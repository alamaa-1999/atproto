import type { Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../context.js'
import checkSignupQueue from './checkSignupQueue.js'
import checkStriker from './checkStriker.js'
import listStrikers from './listStrikers.js'

export default function (server: Server, ctx: AppContext) {
  checkSignupQueue(server, ctx)
  checkStriker(server, ctx)
  listStrikers(server, ctx)
}
