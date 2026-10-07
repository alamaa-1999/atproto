import type { Server } from '@atproto/xrpc-server'
import type { AppContext } from '../../../../context.js'
import checkAdmin from './checkAdmin.js'
import checkSignupQueue from './checkSignupQueue.js'
import checkStriker from './checkStriker.js'
import listPromotionRecords from './listPromotionRecords.js'
import listStrikers from './listStrikers.js'

export default function (server: Server, ctx: AppContext) {
  checkAdmin(server, ctx)
  checkSignupQueue(server, ctx)
  checkStriker(server, ctx)
  listPromotionRecords(server, ctx)
  listStrikers(server, ctx)
}
