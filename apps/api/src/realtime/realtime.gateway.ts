import { Inject, Logger, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, type OnGatewayConnection } from '@nestjs/websockets';
import type { Redis } from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { SESSION_COOKIE } from '../core/auth/context';
import { findSessionUser } from '../core/auth/session.guard';
import { CONFIG, type Config } from '../core/config';
import { DB, type Db } from '../core/db/db.module';
import type { ChangeNotice } from '../core/effects/effects';
import { createRedis, REALTIME_CHANNEL } from '../core/queue/queue.module';

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Browsers connect with their session cookie and join a room for their user. The server
 * only says "request X changed"; the browser refetches through the normal API, so the
 * socket never carries data that skipped the permission checks.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection, OnModuleInit, OnModuleDestroy {
  @WebSocketServer() private readonly server!: Server;
  private readonly logger = new Logger('Realtime');
  private subscriber?: Redis;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  async onModuleInit(): Promise<void> {
    this.subscriber = createRedis(this.config.REDIS_URL);
    this.subscriber.on('message', (_channel: string, message: string) => {
      try {
        const notice = JSON.parse(message) as ChangeNotice;
        const rooms = notice.userIds.map((id) => `user:${id}`);
        if (rooms.length > 0) {
          this.server
            .to(rooms)
            .emit('changed', { orgId: notice.orgId, requestId: notice.requestId });
        }
      } catch (error) {
        this.logger.warn(`Ignoring malformed change notice: ${String(error)}`);
      }
    });
    await this.subscriber.subscribe(REALTIME_CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    await this.subscriber?.quit();
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = readCookie(client.handshake.headers.cookie, SESSION_COOKIE);
    const user = await findSessionUser(this.db, token).catch(() => null);
    if (!user) {
      client.disconnect(true);
      return;
    }
    await client.join(`user:${user.id}`);
  }
}

@Module({ providers: [RealtimeGateway] })
export class RealtimeModule {}
